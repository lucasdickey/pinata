// jsdom lacks the browser APIs @xyflow/react measures with. This is the
// standard React Flow testing mock surface (ResizeObserver,
// DOMMatrixReadOnly, element offset sizes, SVG bounding boxes) so component
// tests can mount the canvas. Component tests assert structure and state,
// never pixel transforms — those are covered by the pure camera oracle and
// real-browser measurements.

class ResizeObserverMock {
  private callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element): void {
    const entry = {
      target,
      contentRect: {
        width: target instanceof HTMLElement ? target.offsetWidth : 0,
        height: target instanceof HTMLElement ? target.offsetHeight : 0,
      },
    } as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }

  unobserve(): void {}

  disconnect(): void {}
}

class DOMMatrixReadOnlyMock {
  m22: number;

  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([\d.]+)\)/)?.[1];
    this.m22 = scale !== undefined ? Number(scale) : 1;
  }
}

let installed = false;

export function installReactFlowMocks(): void {
  if (installed) return;
  installed = true;

  Object.assign(globalThis, {
    ResizeObserver: ResizeObserverMock,
    DOMMatrixReadOnly: DOMMatrixReadOnlyMock,
  });

  // jsdom reports 0 for layout sizes; the canvas camera math needs a
  // positive wrapper size, and so does React Flow itself.
  Object.defineProperties(HTMLElement.prototype, {
    offsetHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return Number.parseFloat(this.style.height) || 600;
      },
    },
    offsetWidth: {
      configurable: true,
      get(this: HTMLElement) {
        return Number.parseFloat(this.style.width) || 800;
      },
    },
    clientHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return Number.parseFloat(this.style.height) || 600;
      },
    },
    clientWidth: {
      configurable: true,
      get(this: HTMLElement) {
        return Number.parseFloat(this.style.width) || 800;
      },
    },
  });

  if (typeof SVGElement !== "undefined") {
    Object.defineProperty(SVGElement.prototype, "getBBox", {
      configurable: true,
      value: () => ({ x: 0, y: 0, width: 0, height: 0 }),
    });
  }
}
