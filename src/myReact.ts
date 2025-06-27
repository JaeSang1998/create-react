import { schedule } from "./scheduler";

// Element(태그·컴포넌트) 식별용
export type ElementType = string | Function | symbol;

// 자식 배열 포함 Prop 타입
export interface Props {
  children: VNode[];
  [key: string]: any;
}
export const enum Lane {
  Immediate = 1,
  Transition = 2,
  Idle = 4,
}
export type LaneType = Lane.Immediate | Lane.Transition | Lane.Idle;

// Virtual DOM 노드
export interface VNode {
  type: ElementType;
  key?: string | number | null;
  props: Props;
}

interface Fiber {
  // 기본 정보
  type: ElementType;
  key?: string | number | null;
  props: Props;
  dom?: Node | null;

  // 트리 구조 (링크드 리스트)
  parent?: Fiber | null;
  child?: Fiber | null;
  sibling?: Fiber | null;
  alternate?: Fiber | null;

  lane?: LaneType; // 작업 우선순위 (Lane)

  // 렌더링 정보
  // lane: LaneType;
  effectTag?: "PLACEMENT" | "UPDATE" | "DELETION";

  // Suspense 관련
  suspended?: boolean;
  promise?: Promise<any> | null;
  isFallback?: boolean;
  isCommitRoot?: boolean;

  // Hooks
  hooks?: any[];
}

export let currentUpdateLane: LaneType = Lane.Idle;
const pendingTransitionCallbacks: (() => void)[] = [];

export function flushUpdate(fn: () => void, lane: LaneType) {
  const prevLane = currentUpdateLane;
  currentUpdateLane = lane;
  fn();
  currentUpdateLane = prevLane;
}

let wipRoot: Fiber | null = null; // work-in-progress
let currentRoot: Fiber | null = null; // 화면에 보이는 트리
let nextUnitOfWork: Fiber | null = null;
let deletions: Fiber[] = [];

// Hooks 관련
let wipFiber: Fiber | null = null;
let hookIdx = 0;

const TEXT_ELEMENT = Symbol("TEXT_ELEMENT");

function createTextElement(text: string): VNode {
  return {
    type: TEXT_ELEMENT,
    props: { nodeValue: text, children: [] },
  };
}

export function createElement(
  type: ElementType,
  props: Record<string, any> | null,
  ...children: any[]
): VNode {
  const { key, ...rest } = props ?? {};
  return {
    type,
    key: key ?? null,
    props: {
      ...rest,
      children: children
        .flat()
        .map((c) => (typeof c === "object" ? c : createTextElement(String(c)))),
    },
  };
}

function createDOM(f: Fiber): Node {
  if (f.type === TEXT_ELEMENT) {
    return document.createTextNode(f.props.nodeValue);
  }

  const el = document.createElement(f.type as string);
  updateDOMProps(el, { children: [] }, f.props);
  return el;
}

function updateDOMProps(el: Node, prevProps: Props, nextProps: Props) {
  // 텍스트 노드 처리
  if (el.nodeType === Node.TEXT_NODE) {
    if (prevProps.nodeValue !== nextProps.nodeValue) {
      el.nodeValue = nextProps.nodeValue;
    }
    return;
  }

  if (!(el instanceof Element)) return;
  const element = el as HTMLElement;

  // 1) 이전 props 삭제
  Object.keys(prevProps).forEach((k) => {
    if (k === "children") return;
    if (k.startsWith("on")) {
      const eventType = k.toLowerCase().substring(2);
      element.removeEventListener(eventType, prevProps[k]);
    } else if (!(k in nextProps)) {
      (element as any)[k] = "";
    }
  });

  // 2) 새로운 props 추가/변경
  Object.keys(nextProps).forEach((k) => {
    if (k === "children") return;
    if (prevProps[k] === nextProps[k]) return;

    if (k.startsWith("on")) {
      const eventType = k.toLowerCase().substring(2);
      element.addEventListener(eventType, nextProps[k]);
    } else {
      (element as any)[k] = nextProps[k];
    }
  });
}

export function render(v: VNode, container: Element | DocumentFragment) {
  wipRoot = {
    ...v,
    dom: container,
    lane: Lane.Transition,
    alternate: currentRoot,
  } as Fiber;
  scheduleLane(Lane.Transition);
}

function performUnit(f: Fiber): Fiber | null {
  const isFn = typeof f.type === "function";
  isFn ? updateFunction(f) : updateHost(f); // ① 현재 노드 처리

  // ② 다음 방문 노드 계산 (DFS: 자식→형제→부모의 형제)
  if (f.child) return f.child;
  let n: Fiber | null = f;
  while (n) {
    if (n.sibling) return n.sibling;
    n = n.parent!;
  }
  return null; // 루트까지 끝 → null
}

function updateHost(f: Fiber) {
  if (!f.dom) {
    f.dom = createDOM(f); // STEP 3에서 만든 함수
  }
  reconcileChildren(f, f.props.children);
}
function commitRoot() {
  deletions.forEach((d) => commitWork(d)); // 1. 삭제 처리
  commitWork(wipRoot?.child!); // 2. 새 DOM 커밋
  flushEffects(); // useEffect 실행

  currentRoot = wipRoot; // 3. 트리 교체
  wipRoot = null;
}

function commitWork(f: Fiber | null) {
  if (!f) return;

  // 1. domParent 탐색 (함수 컴포넌트는 DOM이 없으므로)
  let domParentFiber = f.parent;
  while (domParentFiber && !domParentFiber.dom) {
    domParentFiber = domParentFiber.parent;
  }
  const domParent = domParentFiber?.dom;

  // 2. 효과 적용
  if (f.effectTag === "PLACEMENT" && f.dom != null && domParent) {
    domParent.appendChild(f.dom);
  } else if (f.effectTag === "UPDATE" && f.dom != null) {
    updateDOMProps(f.dom, f.alternate!.props, f.props);
  } else if (f.effectTag === "DELETION" && domParent) {
    commitDeletion(f, domParent);
  }

  // 3. 자식과 형제 순회 (삭제 제외)
  if (f.effectTag !== "DELETION") {
    commitWork(f.child!);
  }
  commitWork(f.sibling!);
}

function commitDeletion(fiber: Fiber, domParent: Node) {
  if (fiber.dom) {
    domParent.removeChild(fiber.dom);
  } else if (fiber.child) {
    commitDeletion(fiber.child, domParent);
  }
}

function reconcileChildren(parent: Fiber, elements: VNode[]) {
  let idx = 0;
  let oldFiber = parent.alternate?.child ?? null; // 이전 렌더링의 자식
  let prevSibling: Fiber | null = null;

  while (idx < elements.length || oldFiber != null) {
    const element = elements[idx];
    let newFiber: Fiber | null = null;

    const sameType =
      oldFiber &&
      element &&
      element.type == oldFiber.type &&
      element.key === oldFiber.key;

    if (sameType) {
      // UPDATE: 타입과 키가 같으면 기존 DOM 재사용
      let needsUpdate = false;
      const oldProps = oldFiber!.props;
      const newProps = element.props;

      // Props 비교하여 실제 업데이트가 필요한지 확인
      const oldKeys = Object.keys(oldProps);
      const newKeys = Object.keys(newProps);

      if (oldKeys.length !== newKeys.length) {
        needsUpdate = true;
      } else {
        for (const key of newKeys) {
          if (key !== "children" && oldProps[key] !== newProps[key]) {
            needsUpdate = true;
            break;
          }
        }
      }

      newFiber = {
        type: oldFiber!.type,
        props: element.props,
        key: oldFiber!.key,
        dom: oldFiber!.dom, // 기존 DOM 재사용
        parent: parent,
        child: null,
        sibling: null,
        alternate: oldFiber,
        effectTag: needsUpdate ? "UPDATE" : undefined,
      };
    }

    if (element && !sameType) {
      // PLACEMENT: 새로운 요소
      newFiber = {
        type: element.type,
        key: element.key,
        props: element.props,
        dom: null,
        parent: parent,
        child: null,
        sibling: null,
        alternate: null,
        effectTag: "PLACEMENT",
      };
    }

    if (oldFiber && !sameType) {
      // DELETION: 제거되는 요소
      oldFiber.effectTag = "DELETION";
      deletions.push(oldFiber);
    }

    if (oldFiber) {
      oldFiber = oldFiber.sibling ?? null;
    }

    if (newFiber) {
      if (idx === 0) {
        parent.child = newFiber;
      } else if (prevSibling) {
        prevSibling.sibling = newFiber;
      }
      prevSibling = newFiber;
    }

    idx++;
  }
}

function updateFunction(f: Fiber) {
  wipFiber = f; // 훅 컨텍스트 설정
  hookIdx = 0; // 훅 인덱스 초기화
  f.hooks ??= []; // 훅 배열 초기화

  const childVNode = (f.type as Function)(f.props);
  reconcileChildren(f, [childVNode]);
}

export function useState<S>(
  init: S
): [S, (action: S | ((prev: S) => S)) => void] {
  if (!wipFiber) throw Error("Hooks outside component");

  const fiber = wipFiber;
  const hookIndex = hookIdx;

  // 이전 훅 가져오기 (리렌더링 시)
  const oldHook = fiber.alternate?.hooks?.[hookIndex];
  const hook = {
    state: oldHook ? oldHook.state : init,
    queue: oldHook ? oldHook.queue || [] : [],
  };

  // 큐에 있는 액션들 처리
  while (hook.queue.length > 0) {
    const action = hook.queue.shift()!;
    hook.state =
      typeof action === "function"
        ? (action as (prev: S) => S)(hook.state)
        : action;
  }
  const setState = (action: S | ((prev: S) => S)) => {
    const lane = currentUpdateLane;
    fiber.hooks![hookIndex].queue.push(action);

    wipRoot = {
      type: currentRoot!.type,
      key: currentRoot!.key,
      dom: currentRoot!.dom,
      props: currentRoot!.props,
      alternate: currentRoot,
      lane,
    } as Fiber;

    scheduleLane(lane);
  };

  // 훅 저장
  fiber.hooks![hookIndex] = hook;
  hookIdx++;

  return [hook.state, setState];
}

export function useTransition(): [boolean, (cb: () => void) => void] {
  const [isPending, setIsPending] = useState(false);

  const startTransition = (cb: () => void) => {
    flushUpdate(() => setIsPending(true), Lane.Immediate);
    pendingTransitionCallbacks.push(() => {
      flushUpdate(() => setIsPending(false), Lane.Immediate);
    });
    flushUpdate(cb, Lane.Transition);
  };

  return [isPending, startTransition];
}

type EffectRecord = {
  deps?: any[];
  cb: () => void | (() => void);
  cleanup?: () => void;
};
let pendingEffects: EffectRecord[] = [];

export function useEffect(cb: () => void | (() => void), deps?: any[]) {
  if (!wipFiber) throw Error("useEffect outside component");
  const hooks = wipFiber.hooks!;
  const old: EffectRecord = wipFiber.alternate?.hooks?.[hookIdx] ?? {};

  let changed = false;
  if (!deps) changed = true;
  else if (!old.deps) changed = true;
  else if (deps.some((d, i) => !Object.is(d, old.deps![i]))) changed = true;

  const h: EffectRecord = { deps, cb, cleanup: old.cleanup };
  hooks[hookIdx++] = h;
  if (changed) pendingEffects.push(h);
}

function flushEffects() {
  const q = pendingEffects;
  pendingEffects = [];
  q.forEach((h) => {
    h.cleanup?.();
    const ret = h.cb();
    h.cleanup = typeof ret === "function" ? ret : undefined;
  });
}
const laneRoots: Record<LaneType, Fiber | null> = {
  [Lane.Immediate]: null,
  [Lane.Transition]: null,
  [Lane.Idle]: null,
};
let isWorkLoopScheduled = false;

function scheduleLane(lane: LaneType) {
  if (laneRoots[lane]) {
    mergeRoot(laneRoots[lane]!, wipRoot!);
  } else {
    laneRoots[lane] = wipRoot!;
  }

  if (!isWorkLoopScheduled) {
    isWorkLoopScheduled = true;
    schedule(workLoop); // STEP 2의 스케줄러 사용
  }
}

function mergeRoot(target: Fiber, incoming: Fiber) {
  target.props = incoming.props; // 간단 합병
}

function workLoop() {
  isWorkLoopScheduled = false;

  const lane = [Lane.Immediate, Lane.Transition, Lane.Idle].find(
    (l) => laneRoots[l]
  );

  if (!lane) return; // No work to do

  wipRoot = laneRoots[lane as LaneType];
  laneRoots[lane as LaneType] = null;

  nextUnitOfWork = wipRoot;
  deletions = [];

  while (nextUnitOfWork) {
    nextUnitOfWork = performUnit(nextUnitOfWork);
  }

  if (wipRoot) {
    const currentLane = wipRoot.lane;
    commitRoot();
    if (currentLane === Lane.Transition) {
      while (pendingTransitionCallbacks.length) {
        pendingTransitionCallbacks.pop()!();
      }
    }
  }

  // Check for more work
  if ([Lane.Immediate, Lane.Transition, Lane.Idle].some((l) => laneRoots[l])) {
    if (!isWorkLoopScheduled) {
      isWorkLoopScheduled = true;
      schedule(workLoop);
    }
  }
}
