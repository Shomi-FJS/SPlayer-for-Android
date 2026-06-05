// 折射位移图计算
// 基于 vue-web-liquid-glass: src/lib/displacementMap.ts
// 使用 Snell 定律计算光线折射路径

export type ShapeType = "circle" | "squircle" | "rectangle" | "pill";

/**
 * 预计算折射位移表
 * 根据玻璃厚度、边框宽度和表面方程，计算每个采样点的位移量
 */
export function calculateDisplacementMap(
  glassThickness: number = 200,
  bezelWidth: number = 50,
  bezelHeightFn: (x: number) => number = (x) => x,
  refractiveIndex: number = 1.5,
  samples: number = 128,
): number[] {
  const eta = 1 / refractiveIndex;

  function refract(normalX: number, normalY: number): [number, number] | null {
    const dot = normalY;
    const k = 1 - eta * eta * (1 - dot * dot);
    if (k < 0) return null;
    const kSqrt = Math.sqrt(k);
    return [-(eta * dot + kSqrt) * normalX, eta - (eta * dot + kSqrt) * normalY];
  }

  return Array.from({ length: samples }, (_, i) => {
    const x = i / samples;
    const y = bezelHeightFn(x);
    const dx = x < 1 ? 0.0001 : -0.0001;
    const y2 = bezelHeightFn(x + dx);
    const derivative = (y2 - y) / dx;
    const magnitude = Math.sqrt(derivative * derivative + 1);
    const normal = [-derivative / magnitude, -1 / magnitude];
    const refracted = refract(normal[0], normal[1]);
    if (!refracted) return 0;
    const remainingHeightOnBezel = y * bezelWidth;
    const remainingHeight = remainingHeightOnBezel + glassThickness;
    return refracted[0] * (remainingHeight / refracted[1]);
  });
}

/**
 * 生成圆形位移图 ImageData
 */
export function calculateDisplacementMap2(
  canvasWidth: number,
  canvasHeight: number,
  objectWidth: number,
  objectHeight: number,
  radius: number,
  bezelWidth: number,
  maximumDisplacement: number,
  precomputedDisplacementMap: number[] = [],
  dpr?: number,
) {
  const devicePixelRatio = dpr ?? (typeof window !== "undefined" ? window.devicePixelRatio ?? 1 : 1);
  const bufferWidth = Math.floor(canvasWidth * devicePixelRatio);
  const bufferHeight = Math.floor(canvasHeight * devicePixelRatio);
  const imageData = new ImageData(bufferWidth, bufferHeight);
  const neutral = 0xff008080;
  new Uint32Array(imageData.data.buffer).fill(neutral);

  const radius_ = radius * devicePixelRatio;
  const bezel = bezelWidth * devicePixelRatio;
  const radiusSquared = radius_ ** 2;
  const radiusPlusOneSquared = (radius_ + 1) ** 2;
  const radiusMinusBezelSquared = (radius_ - bezel) ** 2;
  const objectWidth_ = objectWidth * devicePixelRatio;
  const objectHeight_ = objectHeight * devicePixelRatio;
  const widthBetweenRadiuses = objectWidth_ - radius_ * 2;
  const heightBetweenRadiuses = objectHeight_ - radius_ * 2;
  const objectX = (bufferWidth - objectWidth_) / 2;
  const objectY = (bufferHeight - objectHeight_) / 2;

  for (let y1 = 0; y1 < objectHeight_; y1++) {
    for (let x1 = 0; x1 < objectWidth_; x1++) {
      const idx = (objectY + y1) * bufferWidth + (objectX + x1);
      const idx4 = idx * 4;
      const isOnLeftSide = x1 < radius_;
      const isOnRightSide = x1 >= objectWidth_ - radius_;
      const isOnTopSide = y1 < radius_;
      const isOnBottomSide = y1 >= objectHeight_ - radius_;
      const x = isOnLeftSide ? x1 - radius_ : isOnRightSide ? x1 - radius_ - widthBetweenRadiuses : 0;
      const y = isOnTopSide ? y1 - radius_ : isOnBottomSide ? y1 - radius_ - heightBetweenRadiuses : 0;
      const distanceToCenterSquared = x * x + y * y;
      const isInBezel =
        distanceToCenterSquared <= radiusPlusOneSquared &&
        distanceToCenterSquared >= radiusMinusBezelSquared;

      if (isInBezel) {
        const opacity =
          distanceToCenterSquared < radiusSquared
            ? 1
            : 1 -
              (Math.sqrt(distanceToCenterSquared) - Math.sqrt(radiusSquared)) /
                (Math.sqrt(radiusPlusOneSquared) - Math.sqrt(radiusSquared));
        const distanceFromCenter = Math.sqrt(distanceToCenterSquared);
        const distanceFromSide = radius_ - distanceFromCenter;
        const cos = x / distanceFromCenter;
        const sin = y / distanceFromCenter;
        const bezelIndex = ((distanceFromSide / bezel) * precomputedDisplacementMap.length) | 0;
        const distance = precomputedDisplacementMap[bezelIndex] ?? 0;
        const dX = (-cos * distance) / maximumDisplacement;
        const dY = (-sin * distance) / maximumDisplacement;
        imageData.data[idx4] = 128 + dX * 127 * opacity;
        imageData.data[idx4 + 1] = 128 + dY * 127 * opacity;
        imageData.data[idx4 + 2] = 0;
        imageData.data[idx4 + 3] = 255;
      }
    }
  }
  return imageData;
}

/**
 * 生成形状感知位移图 ImageData（支持 pill/squircle/rectangle）
 */
export function calculateDisplacementMapWithShape(
  canvasWidth: number,
  canvasHeight: number,
  objectWidth: number,
  objectHeight: number,
  bezelWidth: number,
  maximumDisplacement: number,
  precomputedDisplacementMap: number[] = [],
  shape: ShapeType = "pill",
  cornerRadius: number = 1.0,
  squircleExponent: number = 4,
  dpr?: number,
) {
  const devicePixelRatio = dpr ?? (typeof window !== "undefined" ? window.devicePixelRatio ?? 1 : 1);
  const bufferWidth = Math.floor(canvasWidth * devicePixelRatio);
  const bufferHeight = Math.floor(canvasHeight * devicePixelRatio);
  const imageData = new ImageData(bufferWidth, bufferHeight);
  const neutral = 0xff008080;
  new Uint32Array(imageData.data.buffer).fill(neutral);

  const objectWidth_ = objectWidth * devicePixelRatio;
  const objectHeight_ = objectHeight * devicePixelRatio;
  const bezel = bezelWidth * devicePixelRatio;
  const objectX = (bufferWidth - objectWidth_) / 2;
  const objectY = (bufferHeight - objectHeight_) / 2;

  const maxCornerRadius = Math.min(objectWidth_, objectHeight_) / 2;
  let actualRadius: number;
  switch (shape) {
    case "circle":
      actualRadius = maxCornerRadius;
      break;
    case "pill":
      actualRadius = Math.min(objectWidth_, objectHeight_) / 2;
      break;
    case "rectangle":
      actualRadius = cornerRadius * maxCornerRadius;
      break;
    case "squircle":
    default:
      actualRadius = cornerRadius * maxCornerRadius;
      break;
  }

  const radius_ = actualRadius;
  const _radiusSquared = radius_ ** 2;
  const _radiusPlusOneSquared = (radius_ + 1) ** 2;
  const _radiusMinusBezelSquared = Math.max(0, (radius_ - bezel) ** 2);
  const _widthBetweenRadiuses = Math.max(0, objectWidth_ - radius_ * 2);
  const _heightBetweenRadiuses = Math.max(0, objectHeight_ - radius_ * 2);

  const squircleDistance = (x: number, y: number, r: number, n: number): number => {
    if (r === 0) return Math.sqrt(x * x + y * y);
    const absX = Math.abs(x) / r;
    const absY = Math.abs(y) / r;
    return Math.pow(Math.pow(absX, n) + Math.pow(absY, n), 1 / n) * r;
  };

  for (let y1 = 0; y1 < objectHeight_; y1++) {
    for (let x1 = 0; x1 < objectWidth_; x1++) {
      const idx = ((objectY + y1) * bufferWidth + (objectX + x1)) * 4;
      const isOnLeftSide = x1 < radius_;
      const isOnRightSide = x1 >= objectWidth_ - radius_;
      const isOnTopSide = y1 < radius_;
      const isOnBottomSide = y1 >= objectHeight_ - radius_;

      let x = 0,
        y = 0;
      let distanceToEdge = 0;
      let normalX = 0,
        normalY = 0;
      let isInBezelRegion = false;

      if ((isOnLeftSide || isOnRightSide) && (isOnTopSide || isOnBottomSide)) {
        x = isOnLeftSide ? x1 - radius_ : x1 - (objectWidth_ - radius_);
        y = isOnTopSide ? y1 - radius_ : y1 - (objectHeight_ - radius_);
        let distanceFromCornerCenter: number;
        if (shape === "squircle" && cornerRadius > 0) {
          distanceFromCornerCenter = squircleDistance(x, y, radius_, squircleExponent);
        } else {
          distanceFromCornerCenter = Math.sqrt(x * x + y * y);
        }
        distanceToEdge = radius_ - distanceFromCornerCenter;
        if (distanceToEdge >= -1 && distanceToEdge <= bezel) {
          isInBezelRegion = true;
          const magnitude = Math.sqrt(x * x + y * y) || 1;
          normalX = x / magnitude;
          normalY = y / magnitude;
        }
      } else if (isOnLeftSide || isOnRightSide) {
        distanceToEdge = isOnLeftSide ? x1 : objectWidth_ - 1 - x1;
        if (distanceToEdge <= bezel) {
          isInBezelRegion = true;
          normalX = isOnLeftSide ? -1 : 1;
          normalY = 0;
        }
      } else if (isOnTopSide || isOnBottomSide) {
        distanceToEdge = isOnTopSide ? y1 : objectHeight_ - 1 - y1;
        if (distanceToEdge <= bezel) {
          isInBezelRegion = true;
          normalX = 0;
          normalY = isOnTopSide ? -1 : 1;
        }
      }

      if (isInBezelRegion && distanceToEdge >= 0) {
        const opacity = distanceToEdge >= 0 ? 1 : Math.max(0, 1 + distanceToEdge);
        const bezelIndex = Math.min(
          precomputedDisplacementMap.length - 1,
          Math.max(0, ((distanceToEdge / bezel) * precomputedDisplacementMap.length) | 0),
        );
        const distance = precomputedDisplacementMap[bezelIndex] ?? 0;
        const dX = (-normalX * distance) / maximumDisplacement;
        const dY = (-normalY * distance) / maximumDisplacement;
        imageData.data[idx] = 128 + dX * 127 * opacity;
        imageData.data[idx + 1] = 128 + dY * 127 * opacity;
        imageData.data[idx + 2] = 0;
        imageData.data[idx + 3] = 255;
      }
    }
  }
  return imageData;
}
