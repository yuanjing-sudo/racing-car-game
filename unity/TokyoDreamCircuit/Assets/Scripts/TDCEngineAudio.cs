using UnityEngine;

/// <summary>
/// Engine, tyre and wind sound, synthesised from scratch. No audio files.
///
/// Rather than shipping .wav assets that would have to be licensed, this writes
/// into the audio buffer from <c>OnAudioFilterRead</c>:
///
///   * the engine, as a harmonic stack at the firing frequency implied by
///     <see cref="TDCPlayerCar.EngineRpm"/>, so the pitch rises with the
///     tachometer and drops on every upshift;
///   * tyre scrub, noise through a resonant peak, driven by the car's own
///     measured slip;
///   * wind roar, noise with a speed-squared amplitude, which is how wind noise
///     physically scales.
///
/// It is a deliberately simple model - an additive engine, not a sampled one - so
/// it will not fool anyone into thinking it is a recorded V8. It does have the
/// two properties that make engine audio read as real: the pitch tracks rpm, and
/// it drops on the shift. Everything else is texture on top.
/// </summary>
[AddComponentMenu("Tokyo Dream Circuit/Engine Audio")]
[RequireComponent(typeof(AudioSource))]
public class TDCEngineAudio : MonoBehaviour
{
    // ---------------------------------------------------------------------
    // Source
    // ---------------------------------------------------------------------

    [Header("Source")]
    [Tooltip("The car to listen to. Found in the scene if left empty.")]
    public TDCPlayerCar car;

    [Tooltip("Master volume of the whole synthesised mix, 0..1. Keep well below 1: the " +
             "engine is a stacked sum and clips easily.")]
    [Range(0f, 1f)] public float masterGain = 0.32f;

    // ---------------------------------------------------------------------
    // Engine
    // ---------------------------------------------------------------------

    [Header("Engine")]
    [Tooltip("Firing pulses per engine revolution. 2 for a four-stroke four-cylinder: four " +
             "cylinders, each firing once every two revolutions.")]
    public float firingPulsesPerRevolution = 2f;

    [Tooltip("Engine volume at idle, as a fraction of full. An engine is never silent.")]
    [Range(0f, 1f)] public float idleEngineLevel = 0.42f;

    [Tooltip("Harmonics stacked above the firing frequency. More = brighter and raspier, " +
             "fewer = a duller hum.")]
    [Range(1, 32)] public int harmonics = 12;

    [Tooltip("How fast the harmonics fall away. 1.0 is a plain sawtooth, which is harsh; " +
             "slightly under 1 is warmer.")]
    [Range(0.2f, 1.5f)] public float harmonicRolloff = 0.82f;

    [Tooltip("Amount of combustion irregularity, 0..1. Adds the uneven, lumpy quality an " +
             "ideal harmonic stack completely lacks.")]
    [Range(0f, 1f)] public float combustionNoise = 0.22f;

    // ---------------------------------------------------------------------
    // Tyres and wind
    // ---------------------------------------------------------------------

    [Header("Tyres and wind")]
    [Range(0f, 1f)] public float tyreGain = 0.30f;

    [Tooltip("Centre frequency of the tyre scrub, in Hz. Tyre squeal lives around here.")]
    public float tyreFrequency = 1150f;

    [Tooltip("How sharply the tyre noise is tuned. Higher = more of a squeal, lower = a " +
             "broader roar.")]
    public float tyreResonance = 7f;

    [Range(0f, 1f)] public float windGain = 0.16f;

    // ---------------------------------------------------------------------
    // State. Written on the main thread, read on the audio thread - see the note
    // on OnAudioFilterRead.
    // ---------------------------------------------------------------------

    AudioSource source;
    System.Random random = new System.Random(1337);

    double enginePhase;
    double tyrePhase;
    float tyreStateA;
    float tyreStateB;
    float windState;
    float combustionState;
    float levelSmoother;

    void Awake()
    {
        source = GetComponent<AudioSource>();

        // A source with no clip never reaches the DSP graph, so OnAudioFilterRead
        // would simply never be called. A short, silent, looping clip keeps the
        // filter alive; the clip itself contributes nothing.
        int rate = Mathf.Max(8000, AudioSettings.outputSampleRate);
        source.clip = AudioClip.Create("TDC Silence", rate / 10, 1, rate, false);
        source.loop = true;
        source.playOnAwake = false;

        // Gain is applied inside the filter instead, so that a volume of 1 here
        // cannot be mistaken for "muted" and culled.
        source.volume = 1f;
        source.spatialBlend = 0f;
        source.Play();

        if (car == null)
        {
#if UNITY_2023_1_OR_NEWER
            car = FindAnyObjectByType<TDCPlayerCar>();
#else
            car = FindObjectOfType<TDCPlayerCar>();
#endif
        }
    }

    /// <summary>
    /// Called on Unity's audio thread, not the main thread. Everything it reads is
    /// a float or int field written by the main thread, which is atomic on every
    /// platform Unity supports, so no lock is taken: taking one would block the
    /// audio thread and cause dropouts, which is worse than the race it would
    /// avoid.
    /// </summary>
    void OnAudioFilterRead(float[] data, int channels)
    {
        if (data == null || channels <= 0) return;

        int sampleRate = Mathf.Max(8000, AudioSettings.outputSampleRate);
        TDCPlayerCar target = car;

        float level = 0f;

        for (int i = 0; i < data.Length; i += channels)
        {
            float value = NextSample(target, sampleRate);

            for (int channel = 0; channel < channels; channel++)
            {
                // Added rather than assigned, so a real clip assigned to the
                // AudioSource would layer with this instead of being replaced.
                data[i + channel] += value;
            }
        }
    }

    float NextSample(TDCPlayerCar target, int sampleRate)
    {
        float rpm = 900f;
        float load = 0f;
        float slip = 0f;
        float speed01 = 0f;

        if (target != null)
        {
            rpm = target.EngineRpm;
            slip = target.TyreSlip01;
            speed01 = target.Speed01;
            load = Mathf.Clamp01(target.ThrottleInput);
        }

        // Even off the throttle the engine is turning, so a floor is added from
        // rpm: that is what a driver hears as engine braking, not silence.
        load = Mathf.Max(load, Mathf.Clamp01((rpm - 1200f) / 6400f) * 0.55f);

        // ---- Engine --------------------------------------------------------
        float firingHz = rpm / 60f * firingPulsesPerRevolution;
        float engine = 0f;

        if (firingHz > 0f)
        {
            double increment = 2.0 * Math.PI * firingHz / sampleRate;

            for (int h = 1; h <= harmonics; h++)
            {
                engine += (float)System.Math.Sin(enginePhase * h) *
                          Mathf.Pow(h, -harmonicRolloff);
            }

            enginePhase += increment;
            if (enginePhase > 2.0 * Math.PI) enginePhase -= 2.0 * Math.PI;

            // Normalise the harmonic sum back to roughly -1..1.
            engine *= 0.55f / Mathf.Max(1f, harmonics * 0.42f);
        }

        // Combustion irregularity: a fast, noisy wobble on the amplitude, which is
        // what separates an engine from a synthesiser.
        if (combustionNoise > 0f)
        {
            float white = (float)(random.NextDouble() * 2.0 - 1.0);
            combustionState = combustionState * 0.72f + white * 0.28f;
            engine *= 1f + combustionNoise * combustionState;
        }

        engine *= idleEngineLevel + (1f - idleEngineLevel) * load;

        // ---- Tyres ---------------------------------------------------------
        // Two cascaded one-pole filters with feedback around them, which resonates
        // at roughly tyreFrequency. A cheap way to get a squeal out of noise.
        float tyre = 0f;
        if (slip > 0.01f)
        {
            float white = (float)(random.NextDouble() * 2.0 - 1.0);
            float cutoff = Mathf.Clamp(tyreFrequency / sampleRate * 2f * Mathf.PI, 0f, 1f);

            tyreStateA += cutoff * (white - tyreStateA);
            tyreStateB += cutoff * (tyreStateA - tyreStateB);
            tyre = (tyreStateB - tyreStateA) * tyreResonance;

            // A slow wobble, so a long drift does not sound like a held sine.
            tyrePhase += 0.0004;
            if (tyrePhase > 2.0 * Math.PI) tyrePhase -= 2.0 * Math.PI;
            tyre *= 0.75f + 0.25f * (float)System.Math.Sin(tyrePhase);

            tyre *= slip * tyreGain;
        }

        // ---- Wind ----------------------------------------------------------
        float wind = 0f;
        if (speed01 > 0.02f)
        {
            float white = (float)(random.NextDouble() * 2.0 - 1.0);
            windState += 0.06f * (white - windState);
            wind = windState * speed01 * speed01 * windGain * 3f;
        }

        // ---- Mix -----------------------------------------------------------
        float mix = engine + tyre + wind;

        // One-pole smoothing removes the harshest digital edges from the noise
        // terms and stops the mix twitching between frames.
        levelSmoother += 0.35f * (mix - levelSmoother);

        // Soft clip rather than hard: a limiter that rounds instead of tearing.
        return (float)System.Math.Tanh(levelSmoother * 1.15) * 0.9f * masterGain;
    }

    /// <summary>Point the audio at a different car, e.g. after a respawn.</summary>
    public void SetTarget(TDCPlayerCar newTarget)
    {
        car = newTarget;
    }
}
