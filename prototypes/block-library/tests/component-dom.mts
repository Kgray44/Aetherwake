import { componentDocument } from "../../conversation-product/test/component-dom.mts";

/** CPU event/DOM boundary only. No browser layout, styling or native input. */
export function blockDocument() {
  const view = componentDocument(),
    proto = Object.getPrototypeOf(view.root);
  const classes = Object.getOwnPropertyDescriptor(proto, "classList")!.get!;
  Object.defineProperty(proto, "classList", {
    get() {
      return {
        ...classes.call(this),
        contains: (name: string) => this.className.split(" ").includes(name),
      };
    },
  });
  Object.defineProperty(proto, "isConnected", {
    get() {
      return this === view.root || !!this.parentElement?.isConnected;
    },
  });
  proto.prepend = function (...nodes: any[]) {
    for (const node of [...nodes].reverse())
      this.insertBefore(node, this.firstChild);
  };
  proto.insertBefore = function (node: any, next: any) {
    if (next !== null && next?.parentElement !== this)
      throw new Error("NotFoundError");
    if (node === next) return node;
    node.remove();
    node.parentElement = this;
    this.children.splice(
      next === null ? this.children.length : this.children.indexOf(next),
      0,
      node,
    );
    return node;
  };
  const basicMatches = proto.matches;
  const matches = function (this: any, selector: string) {
    let present = true;
    selector = selector.replace(
      /\[(data-[\w-]+)\]/g,
      (_match, name: string) => {
        const key = name
          .slice(5)
          .replace(/-([a-z])/g, (_match, letter: string) =>
            letter.toUpperCase(),
          );
        if (this.dataset[key] === undefined && !this.attrs.has(name))
          present = false;
        return "";
      },
    );
    const tag = selector.match(/^[a-z][a-z0-9-]*/i)?.[0];
    return (
      present &&
      (!tag || this.tagName === tag.toUpperCase()) &&
      basicMatches.call(this, tag ? selector.slice(tag.length) : selector)
    );
  };
  const fullMatch = (node: any, selector: string) => {
    const parts = selector.trim().split(/\s+/);
    if (!matches.call(node, parts.pop()!)) return false;
    let parent = node.parentElement;
    while (parts.length) {
      const part = parts.pop()!;
      while (parent && !matches.call(parent, part))
        parent = parent.parentElement;
      if (!parent) return false;
      parent = parent.parentElement;
    }
    return true;
  };
  proto.querySelectorAll = function (selector: string): any[] {
    return this.children.flatMap((child: any) => [
      ...(selector.split(",").some((part) => fullMatch(child, part))
        ? [child]
        : []),
      ...child.querySelectorAll(selector),
    ]);
  };
  view.doc.createElementNS = (_namespace: string, tag: string) =>
    view.doc.createElement(tag);
  return view;
}

export function card(view: ReturnType<typeof blockDocument>) {
  const make = (tag: string, cls: string, text = "") => {
    const node = view.doc.createElement(tag);
    node.className = cls;
    node.textContent = text;
    return node;
  };
  const article = make("article", "folio"),
    inner = make("div", "folio-inner"),
    top = make("div", "folio-top"),
    grip = make("span", "grip card-kind-label"),
    heading = make("h2", "", "Synthetic title"),
    subtitle = make("div", "folio-subtitle"),
    preview = make("div", "folio-preview"),
    working = make("div", "working-content"),
    editor = make("textarea", ""),
    actions = make("div", "folio-actions"),
    open = make("button", "unfold", "Open ↗"),
    anchor = make("button", "resource-anchor"),
    glyph = make("span", "anchor-glyph"),
    label = make("span", "anchor-label");
  grip.append(make("span", "", "NOTE"));
  top.append(grip);
  working.append(editor);
  actions.append(open);
  label.append(make("small", "", "note"));
  anchor.append(glyph, label);
  inner.append(top, heading, subtitle, preview, working, actions);
  article.append(anchor, inner);
  view.root.append(article);
  return {
    article: article as HTMLElement,
    inner,
    top,
    working,
    editor,
    actions,
    open,
  };
}
