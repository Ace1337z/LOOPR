// CSS modules and plain CSS imports are handled by Metro/Babel at build time.
// Metro strips these imports; TypeScript just needs to know they exist.
declare module '*.css' {
  const classes: Record<string, string>;
  export default classes;
}

declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}