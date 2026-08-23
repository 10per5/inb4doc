import { definePlugin } from "@prosekit/core";
import { createHighlightPlugin } from "prosemirror-highlight";
import { createParser, type Parser } from "prosemirror-highlight/shiki";
import type { Decoration } from "prosemirror-view";
import {
  createHighlighterCore,
  type HighlighterCore,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

import bash from "@shikijs/langs/bash";
import batch from "@shikijs/langs/batch";
import clojure from "@shikijs/langs/clojure";
import c from "@shikijs/langs/c";
import cpp from "@shikijs/langs/cpp";
import csharp from "@shikijs/langs/csharp";
import css from "@shikijs/langs/css";
import dart from "@shikijs/langs/dart";
import diff from "@shikijs/langs/diff";
import dockerfile from "@shikijs/langs/dockerfile";
import elixir from "@shikijs/langs/elixir";
import go from "@shikijs/langs/go";
import graphql from "@shikijs/langs/graphql";
import haskell from "@shikijs/langs/haskell";
import html from "@shikijs/langs/html";
import http from "@shikijs/langs/http";
import ini from "@shikijs/langs/ini";
import java from "@shikijs/langs/java";
import javascript from "@shikijs/langs/javascript";
import json from "@shikijs/langs/json";
import jsx from "@shikijs/langs/jsx";
import julia from "@shikijs/langs/julia";
import kotlin from "@shikijs/langs/kotlin";
import less from "@shikijs/langs/less";
import lua from "@shikijs/langs/lua";
import makefile from "@shikijs/langs/makefile";
import markdown from "@shikijs/langs/markdown";
import nginx from "@shikijs/langs/nginx";
import perl from "@shikijs/langs/perl";
import php from "@shikijs/langs/php";
import powershell from "@shikijs/langs/powershell";
import python from "@shikijs/langs/python";
import r from "@shikijs/langs/r";
import regex from "@shikijs/langs/regex";
import ruby from "@shikijs/langs/ruby";
import rust from "@shikijs/langs/rust";
import scss from "@shikijs/langs/scss";
import sql from "@shikijs/langs/sql";
import swift from "@shikijs/langs/swift";
import toml from "@shikijs/langs/toml";
import tsx from "@shikijs/langs/tsx";
import typescript from "@shikijs/langs/typescript";
import vim from "@shikijs/langs/vim";
import xml from "@shikijs/langs/xml";
import yaml from "@shikijs/langs/yaml";
import zig from "@shikijs/langs/zig";
import oneDarkPro from "@shikijs/themes/one-dark-pro";

const LANG_MODULES = [
  bash,
  batch,
  clojure,
  c,
  cpp,
  csharp,
  css,
  dart,
  diff,
  dockerfile,
  elixir,
  go,
  graphql,
  haskell,
  html,
  http,
  ini,
  java,
  javascript,
  json,
  jsx,
  julia,
  kotlin,
  less,
  lua,
  makefile,
  markdown,
  nginx,
  perl,
  php,
  powershell,
  python,
  r,
  regex,
  ruby,
  rust,
  scss,
  sql,
  swift,
  toml,
  tsx,
  typescript,
  vim,
  xml,
  yaml,
  zig,
];

const LOADED_LANGS = new Set([
  "bash",
  "batch",
  "clojure",
  "c",
  "cpp",
  "csharp",
  "css",
  "dart",
  "diff",
  "dockerfile",
  "elixir",
  "go",
  "graphql",
  "haskell",
  "html",
  "http",
  "ini",
  "java",
  "javascript",
  "json",
  "jsx",
  "julia",
  "kotlin",
  "less",
  "lua",
  "makefile",
  "markdown",
  "nginx",
  "perl",
  "php",
  "powershell",
  "python",
  "r",
  "regex",
  "ruby",
  "rust",
  "scss",
  "sql",
  "swift",
  "toml",
  "tsx",
  "typescript",
  "vim",
  "xml",
  "yaml",
  "zig",
]);

const PLAIN_LANGS = new Set(["text", "plaintext", "txt", "plain"]);

let highlighterPromise: Promise<HighlighterCore> | null = null;
let parser: ReturnType<typeof createParser> | null = null;

function ensureHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [oneDarkPro],
      langs: LANG_MODULES,
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
  }
  return highlighterPromise;
}

const shikiParser: Parser = (options) => {
  if (!parser) {
    return ensureHighlighter().then((highlighter) => {
      parser ??= createParser(highlighter, { theme: "one-dark-pro" });
    });
  }
  const lang = options.language ?? "";
  if (!lang || (!LOADED_LANGS.has(lang) && !PLAIN_LANGS.has(lang))) return [];
  return parser(options);
};

export const codeBlockHighlight = definePlugin(
  createHighlightPlugin({
    parser: shikiParser,
    nodeTypes: ["codeBlock", "mathBlock"],
  }),
);
