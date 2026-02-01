declare module 'rss-parser' {
  // Minimal typings to satisfy TS in this repo.
  // The library is used only for parseString() with a loose feed shape.
  export default class Parser<TFeed = any> {
    constructor(options?: any);
    parseString(xml: string): Promise<TFeed>;
  }
}

