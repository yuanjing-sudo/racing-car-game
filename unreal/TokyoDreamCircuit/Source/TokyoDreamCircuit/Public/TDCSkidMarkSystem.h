#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "TDCSkidMarkSystem.generated.h"

class ATDCPlayerCar;
class UInstancedStaticMeshComponent;
class UMaterialInstanceDynamic;
class USceneComponent;

/**
 * ATDCSkidMarkSystem
 *
 * Rubber laid down by the rear tyres. Asset-free, like everything else in this
 * project: a fixed pool of instanced cubes, each one stretched between two
 * successive rear-wheel contact points, so a slide leaves a continuous pair of
 * lines instead of a trail of dots.
 *
 * Why instances rather than a procedural mesh: a UProceduralMeshComponent has to
 * recreate its section to append geometry, which reallocates and re-uploads the
 * whole buffer. A fixed pool of MaxSegments instances updates one transform per
 * segment, so a 300 km/h slide costs almost nothing.
 *
 * What drives it:
 *   - rear slip angle above MinSlipDegrees, or tyre slip above MinSlip01, so a
 *     handbrake slide and a power-on wheelspin both mark the road;
 *   - absolute speed above MinSpeedKmh, so parking-lot pivots leave nothing;
 *   - a new segment only every SegmentSpacing centimetres, which keeps the pool
 *     long enough to cover most of a lap.
 *
 * The marks are laid at MarkLift above the contact patch, because a coplanar
 * quad z-fights with the road at any distance. Rubber is persistent by default;
 * set MarkLifeSeconds > 0 if you want it to clear itself.
 */
UCLASS(BlueprintType, Blueprintable)
class TOKYODREAMCIRCUIT_API ATDCSkidMarkSystem : public AActor
{
	GENERATED_BODY()

public:
	ATDCSkidMarkSystem();

	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

	/** Hide every mark and reset the pool. */
	UFUNCTION(BlueprintCallable, Category = "Skid Marks")
	void ClearMarks();

	/** Marks currently written to the pool. */
	UFUNCTION(BlueprintPure, Category = "Skid Marks")
	int32 GetActiveSegmentCount() const { return SegmentCount; }

	/** Total slots. At the default spacing this covers about 800 m of sliding. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Skid Marks|Pool", meta = (ClampMin = "16", UIMax = "8000"))
	int32 MaxSegments = 1500;

	/** Rear slip angle, in degrees, at which the tyres start to mark the road. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Skid Marks|Trigger", meta = (ClampMin = "0.0", ClampMax = "60.0"))
	float MinSlipDegrees = 9.0f;

	/** Alternative trigger: the tyre model's combined slip, 0..1. This is what
	 *  catches wheelspin on a straight line, where the slip angle is ~0. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Skid Marks|Trigger", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float MinSlip01 = 0.32f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Skid Marks|Trigger", meta = (ClampMin = "0.0"))
	float MinSpeedKmh = 40.0f;

	/** Distance between segment centres, in centimetres. Smaller = smoother
	 *  curves but a shorter total trail for the same pool. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Skid Marks|Shape", meta = (ClampMin = "5.0", UIMax = "300.0"))
	float SegmentSpacing = 55.0f;

	/** Tyre width in centimetres. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Skid Marks|Shape", meta = (ClampMin = "1.0", UIMax = "200.0"))
	float MarkWidth = 26.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Skid Marks|Shape", meta = (ClampMin = "0.05", UIMax = "10.0"))
	float MarkThickness = 0.6f;

	/** How far above the computational contact patch the mark floats. The patch
	 *  sits 2 cm under the body's underside (ATDCPlayerCar places it a wheel
	 *  radius below the body origin), so 4 cm puts rubber 2 cm over the road and
	 *  clear of z-fighting. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Skid Marks|Shape", meta = (ClampMin = "0.0", UIMax = "20.0"))
	float MarkLift = 4.0f;

	/** Also mark the front wheels. Off by default: understeer scrub is real but
	 *  two lines read more clearly than four. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Skid Marks|Shape")
	bool bFrontWheelsToo = false;

	/** Seconds before a mark is cleared. 0 = permanent, which is what rubber
	 *  actually does. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Skid Marks|Shape", meta = (ClampMin = "0.0"))
	float MarkLifeSeconds = 0.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Skid Marks|Shape")
	FLinearColor RubberColor = FLinearColor(0.018f, 0.018f, 0.020f, 1.0f);

protected:
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Skid Marks")
	TObjectPtr<USceneComponent> Root;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Skid Marks")
	TObjectPtr<UInstancedStaticMeshComponent> Marks;

private:
	void InitPool();
	void HideAll();
	void HideInstance(int32 Index);
	void ApplyWheel(int32 WheelIndex, const FVector& Contact, bool bMarking);
	void WriteSegment(const FVector& A, const FVector& B);
	ATDCPlayerCar* FindCar();

	UPROPERTY()
	TObjectPtr<UMaterialInstanceDynamic> MarkMaterial;

	UPROPERTY()
	TWeakObjectPtr<ATDCPlayerCar> Car;

	/** Last written point per wheel, so the next segment starts where the last
	 *  one ended even across a frame gap. */
	FVector LastPoint[4];
	bool bHasLast[4] = { false, false, false, false };

	/** Seconds left per slot; negative means a permanent mark. */
	TArray<float> RemainingLife;

	int32 NextFree = 0;
	int32 Cursor = 0;
	int32 SegmentCount = 0;
	bool bInitialised = false;
};
