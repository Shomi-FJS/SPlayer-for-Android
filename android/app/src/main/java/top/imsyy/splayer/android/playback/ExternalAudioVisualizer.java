package top.imsyy.splayer.android.playback;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.audiofx.Visualizer;
import android.os.Handler;
import android.os.Looper;
import androidx.core.content.ContextCompat;

final class ExternalAudioVisualizer {
  private static final int OUTPUT_BIN_COUNT = 256;
  private static final int TARGET_CAPTURE_SIZE = 1024;
  private static final float SPECTRUM_FREQ_LOW = 80f;
  private static final float SPECTRUM_FREQ_HIGH = 2000f;
  private static final float LOW_FREQ_BAND_END_HZ = 280f;
  private static final float LOW_FREQ_THRESHOLD = 85f;
  private static final float LOW_FREQ_SMOOTHING = 0.28f;
  private static final float MAGNITUDE_GAIN = 7.0f;
  private static final float MAGNITUDE_GAMMA = 0.68f;

  interface Listener {
    void onData(byte[] fftBins, float lowFreq);

    void onStopped();
  }

  private final Handler mainHandler = new Handler(Looper.getMainLooper());
  private final byte[] outputBins = new byte[OUTPUT_BIN_COUNT];

  private Visualizer visualizer;
  private Listener listener;
  private float lowFreqSmoothed = 0f;

  synchronized boolean start(Context context, Listener listener) {
    stopInternal(false);
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
        != PackageManager.PERMISSION_GRANTED) {
      return false;
    }

    this.listener = listener;
    try {
      visualizer = new Visualizer(0);
      visualizer.setCaptureSize(resolveCaptureSize());
      visualizer.setScalingMode(Visualizer.SCALING_MODE_NORMALIZED);
      visualizer.setDataCaptureListener(
          new Visualizer.OnDataCaptureListener() {
            @Override
            public void onWaveFormDataCapture(
                Visualizer visualizer, byte[] waveform, int samplingRate) {}

            @Override
            public void onFftDataCapture(Visualizer visualizer, byte[] fft, int samplingRate) {
              handleFftData(fft, samplingRate);
            }
          },
          Math.max(1, Visualizer.getMaxCaptureRate() / 2),
          false,
          true);
      visualizer.setEnabled(true);
      return true;
    } catch (Exception error) {
      stopInternal(false);
      return false;
    }
  }

  synchronized void stop() {
    stopInternal(true);
  }

  private synchronized void stopInternal(boolean notifyStopped) {
    Listener cb = listener;
    listener = null;
    lowFreqSmoothed = 0f;
    if (visualizer != null) {
      try {
        visualizer.setEnabled(false);
      } catch (Exception ignored) {
      }
      visualizer.release();
      visualizer = null;
    }
    if (notifyStopped && cb != null) {
      mainHandler.post(cb::onStopped);
    }
  }

  private int resolveCaptureSize() {
    int[] range = Visualizer.getCaptureSizeRange();
    int size = Math.min(TARGET_CAPTURE_SIZE, range[1]);
    size = Math.max(size, range[0]);
    int powerOfTwo = Integer.highestOneBit(size);
    if (powerOfTwo < range[0]) return range[0];
    return powerOfTwo;
  }

  private void handleFftData(byte[] fft, int samplingRateMilliHz) {
    Listener cb;
    synchronized (this) {
      cb = listener;
    }
    if (cb == null || fft == null || fft.length < 4) return;

    int availableBins = Math.max(1, (fft.length / 2) - 1);
    float samplingRateHz = samplingRateMilliHz > 0 ? samplingRateMilliHz / 1000f : 44100f;
    int spectrumBinStart =
        Math.max(1, Math.min(availableBins, (int) Math.floor(SPECTRUM_FREQ_LOW * fft.length / samplingRateHz)));
    int spectrumBinEnd =
        Math.max(spectrumBinStart, Math.min(availableBins, (int) Math.ceil(SPECTRUM_FREQ_HIGH * fft.length / samplingRateHz)));
    int lowFreqBinEnd =
        Math.max(1, Math.min(availableBins, (int) Math.ceil(LOW_FREQ_BAND_END_HZ * fft.length / samplingRateHz)));

    int lowFreqSum = 0;
    int lowFreqCount = 0;
    for (int i = 1; i <= lowFreqBinEnd; i++) {
      lowFreqSum += getAmplifiedMagnitude(fft, i);
      lowFreqCount++;
    }
    float lowFreqAvg = lowFreqCount > 0 ? (float) lowFreqSum / lowFreqCount : 0f;
    float overThreshold = (lowFreqAvg - LOW_FREQ_THRESHOLD) / (255f - LOW_FREQ_THRESHOLD);
    if (overThreshold < 0f) overThreshold = 0f;
    float lowFreqRaw = overThreshold * overThreshold;
    lowFreqSmoothed += LOW_FREQ_SMOOTHING * (lowFreqRaw - lowFreqSmoothed);
    if (lowFreqSmoothed < 0f) lowFreqSmoothed = 0f;
    else if (lowFreqSmoothed > 1f) lowFreqSmoothed = 1f;

    int sourceSpan = spectrumBinEnd - spectrumBinStart;
    if (sourceSpan <= 0) {
      for (int i = 0; i < OUTPUT_BIN_COUNT; i++) outputBins[i] = 0;
    } else {
      for (int i = 0; i < OUTPUT_BIN_COUNT; i++) {
        float srcPos = (float) i * sourceSpan / (OUTPUT_BIN_COUNT - 1);
        int srcLow = spectrumBinStart + (int) srcPos;
        int srcHigh = Math.min(srcLow + 1, spectrumBinEnd);
        float frac = srcPos - (int) srcPos;
        int interp =
            (int)
                (getAmplifiedMagnitude(fft, srcLow) * (1f - frac)
                    + getAmplifiedMagnitude(fft, srcHigh) * frac);
        if (interp < 0) interp = 0;
        else if (interp > 255) interp = 255;
        outputBins[OUTPUT_BIN_COUNT - 1 - i] = (byte) interp;
      }
    }

    cb.onData(outputBins.clone(), lowFreqSmoothed);
  }

  private int getAmplifiedMagnitude(byte[] fft, int bin) {
    int realIndex = bin * 2;
    int imagIndex = realIndex + 1;
    if (realIndex >= fft.length || imagIndex >= fft.length) return 0;
    int real = fft[realIndex];
    int imag = fft[imagIndex];
    float raw = Math.min(255f, (float) Math.hypot(real, imag) * 2f);
    float normalized = raw / 255f;
    // Visualizer 输出偏弱，用软增益避免整体塌在底部。
    float gained =
        (float) (1.0 - Math.exp(-normalized * MAGNITUDE_GAIN))
            / (float) (1.0 - Math.exp(-MAGNITUDE_GAIN));
    float shaped = (float) Math.pow(gained, MAGNITUDE_GAMMA);
    return Math.min(255, Math.max(0, Math.round(shaped * 255f)));
  }
}
