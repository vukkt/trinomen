export const REACT_TS_RULES = `
TYPESCRIPT RULES:
- NEVER use \`any\`. Use \`unknown\` and narrow.
- NEVER use type assertions (\`as Foo\`) unless commenting why narrowing is impossible.
- Prefer \`type\` over \`interface\` unless declaration merging is needed.
- Use \`readonly\` for arrays/objects that shouldn't mutate.
- Use \`satisfies\` over type annotations when assigning literal objects.
- Discriminated unions for state machines, not boolean flags.

REACT RULES:
- Function components only. No class components.
- Hooks at the top, never in conditionals or loops.
- \`useMemo\`/\`useCallback\` ONLY when profiling shows need OR passing to memoized children. Premature memoization is a code smell.
- \`useEffect\` is for sync with external systems: network, DOM, subscriptions, timers, browser APIs.
- Time-based logic (debounce, throttle, intervals) IS sync with an external system. \`useState\` + \`useEffect\` is the correct pattern here.
- Avoid \`useState\` + \`useEffect\` when the value can be computed directly from props or other state in render. That IS the derived-state anti-pattern.
- Refs for imperative DOM, not state.
- Custom hooks start with \`use\`. Return tuples or named objects, not positional arrays past length 2.
- Forward refs only when component wraps a DOM element.
- Key prop must be stable, unique, NOT array index unless list is static.

ACCESSIBILITY:
- Every interactive element keyboard-accessible.
- Buttons for actions, anchors for navigation. NEVER \`<div onClick>\` for clickable elements.
- Form inputs have labels (visible or aria-label).
- Loading/error states announced via aria-live where appropriate.

ARCHITECTURE:
- Components do ONE thing. Split when a component has more than ~150 lines.
- No prop drilling past 2 levels. Lift to context or composition.
- Side effects isolated in custom hooks, never inline in components.
- Errors thrown and caught at boundaries, not silenced.

API DESIGN:
- A hook's signature should match the simplest case the user described.
- If user asked for "useDebounce", the canonical signature is \`useDebounce<T>(value: T, delay: number): T\`.
- Do not introduce options objects, configuration parameters, or return tuples/objects unless the user explicitly asked for them.
- Adding "flexibility" the user didn't request is feature inflation. Flag it.

TIMER PATTERNS:
- Timer IDs (setTimeout, setInterval, requestAnimationFrame) live in \`useRef\`, NEVER in \`useState\`.
- Storing a timer ID in state causes re-renders on every timer set/clear, defeating debouncing/throttling.
- Use \`ReturnType<typeof setTimeout>\` for the ref type, not \`number\`. Cross-platform safe.

FORBIDDEN PATTERNS:
- \`useState\` initialized from props without sync logic
- \`useEffect\` calling \`setState\` based on the same component's state WITHOUT a time-based or external trigger
- Async functions passed directly as event handlers (lose error boundaries)
- Inline object/array literals as props to memoized children
- \`React.FC\` (use explicit return type or omit)
`;
