declare module 'react' {
  export = React
  export as namespace React
  namespace React {
    type CSSProperties = { [key: string]: string | number | undefined }
    type ReactNode = any
    type ReactElement = any
    type ComponentType<P = {}> = (props: P) => any
    type FC<P = {}> = (props: P) => any
    function createElement(type: any, props?: any, ...children: any[]): any
    function useState<T>(initial: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void]
    function useEffect(fn: () => void | (() => void), deps?: readonly any[]): void
    function useCallback<T extends Function>(fn: T, deps: readonly any[]): T
    function useRef<T>(initial: T): { current: T }
    function useMemo<T>(fn: () => T, deps: readonly any[]): T
    namespace Children { function toArray(children: any): any[] }
    namespace Fragment { }
  }
}

declare module 'react/jsx-runtime' {
  export = React
}