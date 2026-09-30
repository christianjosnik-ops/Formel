/// <reference types="vite/client" />
declare const __BUILD__: string;
declare module '*.csv?raw' {
  const content: string;
  export default content;
}
