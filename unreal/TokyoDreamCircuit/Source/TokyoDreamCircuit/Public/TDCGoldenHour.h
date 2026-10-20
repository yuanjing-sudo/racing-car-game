#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "TDCGoldenHour.generated.h"

class APostProcessVolume;
class UDirectionalLightComponent;
class UExponentialHeightFogComponent;
class USceneComponent;
class USkyAtmosphereComponent;
class USkyLightComponent;

/**
 * ATDCGoldenHour
 *
 * The light rig for Neon Horizon: a low, warm sun over the bay, a physical sky,
 * height fog with volumetric scattering, and a filmic grade. One actor, no
 * level set-up, no content:
 *
 *   - directional light at SunElevationDegrees (7 by default), flagged as the
 *     atmosphere sun so the sky reddens toward the horizon;
 *   - sky atmosphere with boosted Mie scattering for the hazy golden-hour air;
 *   - real-time sky light for the blue fill in the shadows;
 *   - exponential height fog, volumetric, warm inscattering;
 *   - an unbound post-process volume: bloom, warm highlights, cyan shadows,
 *     vignette, grain, chromatic aberration, motion blur and a shallow depth of
 *     field for the chase camera.
 *
 * The volume is spawned by this actor and destroyed with it. It is intentionally
 * separate from ATDCWorldLandmarks so the city can be rebuilt without touching
 * the lighting, and vice versa.
 *
 * Exposure is automatic: the absolute light values are physical-ish, but the
 * engine's eye adaptation does the final stop. Raise SunIntensity for a hotter
 * sun, or add AutoExposureBias overrides in the volume if you want a fixed stop.
 */
UCLASS(BlueprintType, Blueprintable)
class TOKYODREAMCIRCUIT_API ATDCGoldenHour : public AActor
{
	GENERATED_BODY()

public:
	ATDCGoldenHour();

	virtual void OnConstruction(const FTransform& Transform) override;
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

	/** Re-apply every value to the components and the grade. */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Golden Hour")
	void ApplyGoldenHour();

	/** Move the sun. 0 = on the horizon, 90 = noon. */
	UFUNCTION(BlueprintCallable, Category = "Golden Hour")
	void SetSunElevation(float Degrees);

	UFUNCTION(BlueprintPure, Category = "Golden Hour")
	float GetSunElevation() const { return SunElevationDegrees; }

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Golden Hour|Sun", meta = (ClampMin = "-5.0", ClampMax = "90.0"))
	float SunElevationDegrees = 7.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Golden Hour|Sun", meta = (ClampMin = "0.0", ClampMax = "360.0"))
	float SunAzimuthDegrees = 200.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Golden Hour|Sun")
	FLinearColor SunColor = FLinearColor(1.0f, 0.56f, 0.28f);

	/** Directional light intensity in lux. Auto exposure does the rest. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Golden Hour|Sun", meta = (ClampMin = "0.0"))
	float SunIntensity = 6.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Golden Hour|Sun", meta = (ClampMin = "0.0"))
	bool bCastSunShadows = true;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Golden Hour|Sky", meta = (ClampMin = "0.0"))
	float SkyLightIntensity = 1.4f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Golden Hour|Sky", meta = (ClampMin = "0.0"))
	float SkyLightColorTemperature = 6800.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Golden Hour|Sky", meta = (ClampMin = "0.0", UIMax = "4.0"))
	float MieScatteringScale = 1.7f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Golden Hour|Fog", meta = (ClampMin = "0.0"))
	float FogDensity = 0.018f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Golden Hour|Fog", meta = (ClampMin = "0.0"))
	float FogHeightFalloff = 0.14f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Golden Hour|Fog")
	FLinearColor FogInscattering = FLinearColor(1.0f, 0.60f, 0.36f);

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Golden Hour|Fog")
	bool bVolumetricFog = true;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Golden Hour|Grade", meta = (ClampMin = "0.0"))
	float BloomIntensity = 1.35f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Golden Hour|Grade", meta = (ClampMin = "0.0"))
	float BloomThreshold = -0.45f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Golden Hour|Grade", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float VignetteIntensity = 0.55f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Golden Hour|Grade", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float FilmGrainIntensity = 0.22f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Golden Hour|Grade", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float MotionBlurAmount = 0.45f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Golden Hour|Grade", meta = (ClampMin = "0.0", UIMax = "5.0"))
	float SceneFringeIntensity = 0.8f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Golden Hour|Grade")
	bool bBuildPostProcess = true;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Golden Hour|Setup")
	bool bBuildOnConstruction = true;

protected:
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Golden Hour")
	TObjectPtr<USceneComponent> Root;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Golden Hour")
	TObjectPtr<UDirectionalLightComponent> Sun;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Golden Hour")
	TObjectPtr<USkyAtmosphereComponent> Atmosphere;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Golden Hour")
	TObjectPtr<USkyLightComponent> SkyLight;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Golden Hour")
	TObjectPtr<UExponentialHeightFogComponent> Fog;

private:
	void EnsurePostProcess();
	void DestroyPostProcess();

	UPROPERTY()
	TObjectPtr<APostProcessVolume> PostProcess;
};
