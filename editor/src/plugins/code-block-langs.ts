// Static import registry for Prism language grammars.
// Each import creates a code-split chunk that loads on demand.
// This file must be statically analyzable by esbuild.

export const LANG_IMPORTS: Record<string, () => Promise<any>> = {
  javascript: () => import("prism-code-editor/prism/languages/javascript"),
  typescript: () => import("prism-code-editor/prism/languages/typescript"),
  jsx: async () => {
    await import("prism-code-editor/prism/languages/jsx");
    await import("prism-code-editor/languages/jsx");
  },
  tsx: async () => {
    await import("prism-code-editor/prism/languages/tsx");
    await import("prism-code-editor/languages/jsx");
  },
  python: () => import("prism-code-editor/prism/languages/python"),
  // Farm tree-shakes the side-effect-only `import "./xml.js"` inside
  // `prism/languages/markup.js`, so the xml grammar must be loaded explicitly
  // first or `languages.xml` is undefined and markup.js throws at `markup.tag`.
  markup: async () => {
    await import("prism-code-editor/prism/languages/xml");
    await import("prism-code-editor/prism/languages/markup");
    await import("prism-code-editor/languages/html");
  },
  xml: async () => {
    await import("prism-code-editor/prism/languages/xml");
    await import("prism-code-editor/languages/xml");
  },
  css: () => import("prism-code-editor/prism/languages/css"),
  bash: () => import("prism-code-editor/prism/languages/bash"),
  json: () => import("prism-code-editor/prism/languages/json"),
  yaml: () => import("prism-code-editor/prism/languages/yaml"),
  toml: () => import("prism-code-editor/prism/languages/toml"),
  markdown: async () => {
    await import("prism-code-editor/prism/languages/xml");
    await import("prism-code-editor/prism/languages/markup");
    await import("prism-code-editor/prism/languages/markdown");
  },
  latex: () => import("prism-code-editor/prism/languages/latex"),
  rust: () => import("prism-code-editor/prism/languages/rust"),
  go: () => import("prism-code-editor/prism/languages/go"),
  java: () => import("prism-code-editor/prism/languages/java"),
  c: () => import("prism-code-editor/prism/languages/c"),
  cpp: () => import("prism-code-editor/prism/languages/cpp"),
  csharp: () => import("prism-code-editor/prism/languages/csharp"),
  kotlin: () => import("prism-code-editor/prism/languages/kotlin"),
  dart: () => import("prism-code-editor/prism/languages/dart"),
  swift: () => import("prism-code-editor/prism/languages/swift"),
  ruby: () => import("prism-code-editor/prism/languages/ruby"),
  php: () => import("prism-code-editor/prism/languages/php"),
  sql: () => import("prism-code-editor/prism/languages/sql"),
  graphql: () => import("prism-code-editor/prism/languages/graphql"),
  docker: () => import("prism-code-editor/prism/languages/docker"),
  nginx: () => import("prism-code-editor/prism/languages/nginx"),
  git: () => import("prism-code-editor/prism/languages/git"),
  diff: () => import("prism-code-editor/prism/languages/diff"),
  makefile: () => import("prism-code-editor/prism/languages/makefile"),
  ini: () => import("prism-code-editor/prism/languages/ini"),
  lua: () => import("prism-code-editor/prism/languages/lua"),
  elixir: () => import("prism-code-editor/prism/languages/elixir"),
  haskell: () => import("prism-code-editor/prism/languages/haskell"),
  julia: () => import("prism-code-editor/prism/languages/julia"),
  r: () => import("prism-code-editor/prism/languages/r"),
  perl: () => import("prism-code-editor/prism/languages/perl"),
  clojure: () => import("prism-code-editor/prism/languages/clojure"),
  powershell: () => import("prism-code-editor/prism/languages/powershell"),
  batch: () => import("prism-code-editor/prism/languages/batch"),
  http: () => import("prism-code-editor/prism/languages/http"),
  regex: () => import("prism-code-editor/prism/languages/regex"),
  vim: () => import("prism-code-editor/prism/languages/vim"),
  zig: () => import("prism-code-editor/prism/languages/zig"),
  scss: () => import("prism-code-editor/prism/languages/scss"),
  less: () => import("prism-code-editor/prism/languages/less"),
};
