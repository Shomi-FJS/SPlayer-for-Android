// 表面方程定义
// 基于 vue-web-liquid-glass: src/lib/surfaceEquations.ts

export type SurfaceFnDef = {
  title: string;
  fn: (x: number) => number;
};

// 凸圆表面
export const CONVEX_CIRCLE: SurfaceFnDef = {
  title: "Convex Circle",
  fn: (x) => Math.sqrt(1 - (1 - x) ** 2),
};

// 凸方圆表面
export const CONVEX: SurfaceFnDef = {
  title: "Convex Squircle",
  fn: (x) => Math.pow(1 - Math.pow(1 - x, 4), 1 / 4),
};

// 凹表面
export const CONCAVE: SurfaceFnDef = {
  title: "Concave",
  fn: (x) => 1 - CONVEX_CIRCLE.fn(x),
};

// 唇边表面
export const LIP: SurfaceFnDef = {
  title: "Lip",
  fn: (x) => {
    const convex = CONVEX.fn(x * 2);
    const concave = CONCAVE.fn(x) + 0.1;
    const smootherstep = 6 * x ** 5 - 15 * x ** 4 + 10 * x ** 3;
    return convex * (1 - smootherstep) + concave * smootherstep;
  },
};
