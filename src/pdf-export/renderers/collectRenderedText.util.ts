import { ReactNode } from 'react';

interface InspectableElement {
  type: unknown;
  props?: { children?: ReactNode };
}

function isInspectableElement(node: object): node is InspectableElement {
  return 'type' in node && 'props' in node;
}

// Test-only helper (TechSpec: Testing Approach — asserts on the composed
// element tree passed to `renderToBuffer` rather than parsing the binary
// output). Flattens every string/number leaf of a React element tree, in
// document order. @react-pdf's own primitives (Document/Page/View/Text) are
// host-type elements reached via `props.children`, same as react-dom; this
// tree also composes plain function components (PdfHeader and this
// module's own per-row/per-day/per-session components), which have no
// `children` prop of their own — those are only visible by actually
// invoking `type(props)` to get what they render, one level at a time.
export function collectRenderedText(node: ReactNode): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return [];
  }
  if (typeof node === 'string') return [node];
  if (typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(collectRenderedText);

  if (typeof node === 'object' && isInspectableElement(node)) {
    if (typeof node.type === 'function') {
      const rendered = (node.type as (props: unknown) => ReactNode)(node.props);
      return collectRenderedText(rendered);
    }
    return collectRenderedText(node.props?.children);
  }

  return [];
}

export function renderedText(node: ReactNode): string {
  return collectRenderedText(node).join('');
}
