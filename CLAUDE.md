# kagemusha

## コーディング規約

- `function` 宣言は使わず、`const` + アロー関数で書く
  ```ts
  // NG
  function foo(x: number): string { ... }

  // OK
  const foo = (x: number): string => { ... };
  ```
