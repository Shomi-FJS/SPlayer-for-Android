import { computed } from "vue";
import { useDevice } from "./useDevice";

export type ResponsiveMode = "phonePortrait" | "phoneLandscape" | "padPortrait" | "padLandscape";
export type ResponsiveModeTransition = "idle" | "toPortrait" | "toLandscape";

interface ResponsiveModeInput {
  isPadDevice: boolean;
  isLandscape: boolean;
  isPadLayout?: boolean;
}

export const getResponsiveMode = ({
  isPadDevice,
  isLandscape,
  isPadLayout,
}: ResponsiveModeInput): ResponsiveMode => {
  if (isPadLayout ?? (isPadDevice && isLandscape)) return "padLandscape";
  if (isPadDevice && !isLandscape) return "padPortrait";
  return isLandscape ? "phoneLandscape" : "phonePortrait";
};

const isLandscapeMode = (mode: ResponsiveMode) => mode.endsWith("Landscape");

export const getResponsiveModeTransition = (
  from: ResponsiveMode,
  to: ResponsiveMode,
): ResponsiveModeTransition => {
  if (from === to) return "idle";
  return isLandscapeMode(to) ? "toLandscape" : "toPortrait";
};

export const useResponsiveMode = () => {
  const { isPad, isPadDevice, isLandscape } = useDevice();

  const responsiveMode = computed(() =>
    getResponsiveMode({
      isPadDevice: isPadDevice.value,
      isLandscape: isLandscape.value,
      isPadLayout: isPad.value,
    }),
  );

  return {
    responsiveMode,
    isPhonePortraitMode: computed(() => responsiveMode.value === "phonePortrait"),
    isPhoneLandscapeMode: computed(() => responsiveMode.value === "phoneLandscape"),
    isPadPortraitMode: computed(() => responsiveMode.value === "padPortrait"),
    isPadLandscapeMode: computed(() => responsiveMode.value === "padLandscape"),
  };
};
