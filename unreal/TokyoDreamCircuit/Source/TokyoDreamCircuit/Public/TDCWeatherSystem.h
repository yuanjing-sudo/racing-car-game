#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Math/RandomStream.h"
#include "TDCWeatherSystem.generated.h"

class ATDCPlayerCar;
class ATDCProceduralRoad;
class UInstancedStaticMeshComponent;
class UMaterialInstanceDynamic;
class UTDCRainAudioComponent;
class USceneComponent;

/**
 * ATDCWeatherSystem
 *
 * The rain-slicked half of Neon Horizon. Three things, all procedural:
 *
 *   1. Rain. MaxDrops thin instanced streaks live in a box that follows the
 *      player camera. Falling costs one batch transform update per frame; when
 *      Photo Mode slows world time the drops hang in the air for free.
 *   2. Wheel spray. The car throws a plume of vapour off the rear tyres,
 *      scaling with speed and drift angle. This is what sells 300 km/h in the
 *      wet, more than the rain itself.
 *   3. Wetness. Drives ATDCPlayerCar::Wetness (grip) and, if the road material
 *      exposes them, the scalar parameters "Wetness", "RainIntensity" and
 *      "PuddleMask" on the road's dynamic material instance.
 *
 * The streaks use /Engine/BasicShapes/Cube, so no content is imported. They are
 * lit geometry, not a Niagara system: there is no rain material asset here, and
 * a lit streak still catches the golden sun and the neon, which is the look.
 */
UCLASS(BlueprintType, Blueprintable)
class TOKYODREAMCIRCUIT_API ATDCWeatherSystem : public AActor
{
	GENERATED_BODY()

public:
	ATDCWeatherSystem();

	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

	UFUNCTION(BlueprintCallable, Category = "Weather")
	void SetRainIntensity(float NewIntensity);

	UFUNCTION(BlueprintPure, Category = "Weather")
	float GetRainIntensity() const { return RainIntensity; }

	/** Re-apply rain intensity to grip and the road material now. */
	UFUNCTION(BlueprintCallable, Category = "Weather")
	void RefreshWetness();

	/** Start or stop the synthesised rain bed. Photo Mode uses this so a frozen
	 *  frame is also silent. */
	UFUNCTION(BlueprintCallable, Category = "Weather")
	void SetAudioEnabled(bool bEnabled);

	/** 0 = dry, 1 = a wall of water. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Weather|Rain", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float RainIntensity = 0.8f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Weather|Rain", meta = (ClampMin = "0", UIMax = "12000"))
	int32 MaxDrops = 2400;

	/** Half-size of the rain box around the camera, in centimetres. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Weather|Rain", meta = (ClampMin = "200.0"))
	float RainRadius = 3500.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Weather|Rain", meta = (ClampMin = "200.0"))
	float RainHeight = 2800.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Weather|Rain", meta = (ClampMin = "100.0"))
	float FallSpeed = 2400.0f;

	/** Horizontal drift of the streaks, centimetres per second. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Weather|Rain")
	FVector WindDrift = FVector(220.0f, 90.0f, 0.0f);

	/** Smallest streak length at zero intensity; the streak grows with it. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Weather|Rain", meta = (ClampMin = "0.01"))
	float StreakLength = 1.1f;

	/** Drive ATDCPlayerCar::Wetness from RainIntensity. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Weather|Grip")
	bool bDriveCarWetness = true;

	/** Send the wetness parameters to the road's dynamic material. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Weather|Road")
	bool bWetRoad = true;

	/** Grip wetness used at full rain. Blended from RainIntensity. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Weather|Grip", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float FullRainWetness = 0.88f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Weather|Spray")
	bool bWheelSpray = true;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Weather|Spray", meta = (ClampMin = "0", UIMax = "2000"))
	int32 MaxSprayPuffs = 340;

protected:
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Weather")
	TObjectPtr<USceneComponent> Root;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Weather")
	TObjectPtr<UInstancedStaticMeshComponent> Rain;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Weather")
	TObjectPtr<UInstancedStaticMeshComponent> Spray;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Weather")
	TObjectPtr<UTDCRainAudioComponent> RainAudio;

private:
	void InitRain();
	void InitSpray();
	void TickRain(float DeltaSeconds);
	void TickSpray(float DeltaSeconds);
	void SpawnSpray(const FVector& Location, const FVector& Velocity, float Life);

	UPROPERTY()
	TObjectPtr<UMaterialInstanceDynamic> RainMaterial;

	UPROPERTY()
	TObjectPtr<UMaterialInstanceDynamic> SprayMaterial;

	UPROPERTY()
	TObjectPtr<UMaterialInstanceDynamic> RoadMaterial;

	UPROPERTY()
	TWeakObjectPtr<ATDCProceduralRoad> Road;

	UPROPERTY()
	TWeakObjectPtr<ATDCPlayerCar> Car;

	TArray<FVector> DropPositions;
	TArray<FTransform> DropTransforms;
	TArray<FVector> SprayPositions;
	TArray<FVector> SprayVelocities;
	TArray<float> SprayLives;
	TArray<FTransform> SprayTransforms;

	FRandomStream Random;
	int32 ActiveDrops = 0;
	int32 SprayCursor = 0;
	float SpawnAccumulator = 0.0f;
	float WetnessRefreshTimer = 0.0f;
	bool bInitialised = false;
	bool bAudioEnabled = true;
};
