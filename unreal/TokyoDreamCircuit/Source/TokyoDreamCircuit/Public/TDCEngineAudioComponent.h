#pragma once

#include "CoreMinimal.h"
#include "Components/SynthComponent.h"
#include "TDCEngineAudioComponent.generated.h"

class ATDCPlayerCar;

/**
 * UTDCEngineAudioComponent
 *
 * Engine, tyre and wind sound, synthesised at runtime. No audio assets, nothing
 * to import, nothing to license.
 *
 * This is the Unreal counterpart of the Unity project's TDCEngineAudio and the
 * Godot project's TDCEngineAudio. All three write straight into the audio buffer
 * in maths and are driven by the same car telemetry:
 *
 *   * the engine, as a harmonic stack at the firing frequency implied by
 *     GetEngineRpm(), so the pitch rises with the tachometer and drops on every
 *     upshift;
 *   * tyre scrub, noise through a resonant peak, driven by GetTyreSlip01();
 *   * wind roar, noise with a speed-squared amplitude, which is how wind noise
 *     physically scales.
 *
 * Threading: OnGenerateAudio runs on the audio render thread, not the game
 * thread. It therefore reads a small set of plain floats that TickComponent
 * copies across on the game thread once per frame, rather than reaching into the
 * car from the audio thread. A single writer and a single reader of a float needs
 * no lock, and taking one would block the audio thread and cause dropouts, which
 * is worse than the race it would avoid.
 *
 * On channel count: the component renders mono and lets Unreal's mixer upmix,
 * which is the least surprising thing to do when the sample-count semantics of
 * OnGenerateAudio cannot be verified without building the engine. If the audio
 * comes out at the wrong pitch or half length, NumChannels is the knob.
 */
UCLASS(ClassGroup = (TokyoDreamCircuit), meta = (BlueprintSpawnableComponent))
class TOKYODREAMCIRCUIT_API UTDCEngineAudioComponent : public USynthComponent
{
	GENERATED_BODY()

public:
	UTDCEngineAudioComponent();

	// ---------------------------------------------------------------------
	// Mix
	// ---------------------------------------------------------------------

	/** Master gain of the whole synthesised mix. Keep well below 1: the engine
	 *  is a stacked sum and clips easily. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Engine Audio", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float MasterGain = 0.32f;

	// ---------------------------------------------------------------------
	// Engine
	// ---------------------------------------------------------------------

	/** Firing pulses per engine revolution. 2 for a four-stroke four-cylinder:
	 *  four cylinders, each firing once every two revolutions. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Engine Audio|Engine", meta = (ClampMin = "0.5"))
	float FiringPulsesPerRevolution = 2.0f;

	/** Engine level at idle, as a fraction of full. An engine is never silent. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Engine Audio|Engine", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float IdleEngineLevel = 0.42f;

	/** Harmonics stacked above the firing frequency. More = brighter and
	 *  raspier, fewer = a duller hum. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Engine Audio|Engine", meta = (ClampMin = "1", ClampMax = "32"))
	int32 Harmonics = 12;

	/** How fast the harmonics fall away. 1.0 is a plain sawtooth, which is
	 *  harsh; slightly under 1 is warmer. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Engine Audio|Engine", meta = (ClampMin = "0.2", ClampMax = "1.5"))
	float HarmonicRolloff = 0.82f;

	/** Combustion irregularity, 0..1. Adds the uneven, lumpy quality an ideal
	 *  harmonic stack completely lacks. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Engine Audio|Engine", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float CombustionNoise = 0.22f;

	// ---------------------------------------------------------------------
	// Tyres and wind
	// ---------------------------------------------------------------------

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Engine Audio|Tyres", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float TyreGain = 0.30f;

	/** Centre frequency of the tyre scrub, in Hz. Tyre squeal lives here. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Engine Audio|Tyres", meta = (ClampMin = "100.0"))
	float TyreFrequency = 1150.0f;

	/** How sharply the tyre noise is tuned. Higher = more squeal. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Engine Audio|Tyres", meta = (ClampMin = "1.0"))
	float TyreResonance = 7.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Engine Audio|Tyres", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float WindGain = 0.16f;

protected:
	virtual void BeginPlay() override;
	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;

	/** USynthComponent. Called once when the synth is created. */
	virtual bool Init(int32& SampleRate) override;

	/** USynthComponent. Called on the audio render thread. */
	virtual int32 OnGenerateAudio(float* OutAudio, int32 NumSamples) override;

private:
	/** Called on the game thread, once per frame. */
	void SampleTelemetry();

	float NextSample(int32 SampleRate);

	/** The car being listened to. Not a UPROPERTY: it is only ever used from the
	 *  game thread, and a hard reference would not express anything. */
	TWeakObjectPtr<ATDCPlayerCar> Car;

	// Telemetry, written on the game thread and read on the audio thread.
	float CachedRpm = 900.0f;
	float CachedThrottle = 0.0f;
	float CachedSlip = 0.0f;
	float CachedSpeed01 = 0.0f;

	// Audio-thread state.
	int32 CachedSampleRate = 48000;
	double EnginePhase = 0.0;
	double TyrePhase = 0.0;
	float TyreStateA = 0.0f;
	float TyreStateB = 0.0f;
	float WindState = 0.0f;
	float CombustionState = 0.0f;
	float LevelSmoother = 0.0f;

	FRandomStream Noise;
};
