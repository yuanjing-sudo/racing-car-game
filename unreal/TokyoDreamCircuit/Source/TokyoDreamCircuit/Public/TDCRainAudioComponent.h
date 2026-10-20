#pragma once

#include "CoreMinimal.h"
#include "Components/SynthComponent.h"
#include "Math/RandomStream.h"
#include "TDCRainAudioComponent.generated.h"

/**
 * UTDCRainAudioComponent
 *
 * Rain, synthesised at runtime from filtered noise. No audio assets.
 *
 * Two layers, which is roughly how rain sounds:
 *   - body: white noise through a one-pole low-pass at BodyCutoffHz, the dull
 *     roar of water on the car and the road;
 *   - hiss: the same noise through a one-pole high-pass at HissCutoffHz, the
 *     spray off the tyres and the drops hitting the glass.
 *
 * The mix follows rain intensity, and the level also rises with speed, because
 * at 300 km/h the car is driving into the rain rather than sitting under it. A
 * short gain smoother removes zipper noise when the weather changes.
 *
 * This is a bed, not a simulation: there are no individual droplets, no splashes
 * on the road and no rain-on-roof layer, because each would need either a sample
 * or a much more elaborate grain synthesiser. The engine audio component in the
 * same project is the model to follow if you want to extend it.
 *
 * Mono, upmixed by Unreal's mixer, for the same reason as the engine audio.
 */
UCLASS(ClassGroup = (TokyoDreamCircuit), meta = (BlueprintSpawnableComponent))
class TOKYODREAMCIRCUIT_API UTDCRainAudioComponent : public USynthComponent
{
	GENERATED_BODY()

public:
	UTDCRainAudioComponent();

	virtual void BeginPlay() override;
	virtual bool Init(int32& SampleRate) override;
	virtual int32 OnGenerateAudio(float* OutAudio, int32 NumSamples) override;

	/** 0 = dry, 1 = a wall of water. Safe to call every frame. */
	UFUNCTION(BlueprintCallable, Category = "Rain Audio")
	void SetRainIntensity(float NewIntensity) { TargetIntensity = FMath::Clamp(NewIntensity, 0.0f, 1.0f); }

	/** 0..1 car speed, which thickens the bed at speed. */
	UFUNCTION(BlueprintCallable, Category = "Rain Audio")
	void SetSpeed01(float NewSpeed01) { TargetSpeed01 = FMath::Clamp(NewSpeed01, 0.0f, 1.0f); }

	UFUNCTION(BlueprintPure, Category = "Rain Audio")
	float GetRainIntensity() const { return TargetIntensity; }

	/** Master gain. Rain should sit under the engine, not over it. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rain Audio", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float MasterGain = 0.11f;

	/** Low-pass corner of the body layer, in Hz. Lower = heavier downpour. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rain Audio", meta = (ClampMin = "60.0", ClampMax = "4000.0"))
	float BodyCutoffHz = 380.0f;

	/** High-pass corner of the hiss layer, in Hz. Higher = thinner, sprayier. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rain Audio", meta = (ClampMin = "400.0", ClampMax = "16000.0"))
	float HissCutoffHz = 3000.0f;

	/** Mix of body to hiss. 0 is all body, 1 all hiss. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rain Audio", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float HissMix = 0.38f;

	/** Extra level from speed. At 1.0 a 300 km/h run is twice as loud. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rain Audio", meta = (ClampMin = "0.0", ClampMax = "3.0"))
	float SpeedGain = 1.0f;

	/** Gain smoothing time constant, seconds. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rain Audio", meta = (ClampMin = "0.01", ClampMax = "2.0"))
	float SmoothingSeconds = 0.08f;

private:
	float NextSample();

	/** Written by the game thread, read by the audio thread. A float store is
	 *  atomic enough for a level; a lock would risk a dropout, which is worse. */
	float TargetIntensity = 0.0f;
	float TargetSpeed01 = 0.0f;

	float CurrentGain = 0.0f;
	float CurrentHiss = 0.38f;

	float LowCoeff = 0.05f;
	float HighCoeff = 0.70f;
	float GainCoeff = 0.0005f;

	float LowState = 0.0f;
	float HighState = 0.0f;
	float HighPrevious = 0.0f;

	int32 CachedSampleRate = 48000;

	FRandomStream Noise;
};
