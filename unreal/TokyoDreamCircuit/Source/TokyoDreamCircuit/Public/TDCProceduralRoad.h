#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "TDCProceduralRoad.generated.h"

class USplineComponent;
class UProceduralMeshComponent;
class UMaterialInterface;

/** One point of the road cross-section. LateralFraction is normalised so the
 *  profile scales with RoadWidth: -0.5 is the left edge, +0.5 the right edge,
 *  0.0 the centreline. HeightOffset is in centimetres (negative = below). */
USTRUCT(BlueprintType)
struct FTDCRoadProfilePoint
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Road|Profile")
	float LateralFraction = 0.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Road|Profile")
	float HeightOffset = 0.0f;
};

/**
 * ATDCProceduralRoad
 *
 * Generates a drivable road as a procedural mesh swept along a spline, with
 * complex collision. Width, elevation, curvature and banking are all adjustable
 * in the details panel, and banking is derived from the real curvature of the
 * road rather than dialled in per sample.
 *
 * Two ready-made generators:
 *   BuildStraightRoad()    - a long open road along +X built from RoadLength,
 *                            CurveAmplitude and ElevationAmplitude. This is the
 *                            original starter layout, kept so existing levels
 *                            and tuning still behave the same way.
 *   BuildDefaultCircuit()  - a closed loop with no self-intersections.
 *
 * Or skip both and author the spline by hand: RebuildRoad() sweeps whatever the
 * spline says. Tick-free, so geometry costs nothing at runtime.
 */
UCLASS(BlueprintType, Blueprintable)
class TOKYODREAMCIRCUIT_API ATDCProceduralRoad : public AActor
{
	GENERATED_BODY()

public:
	ATDCProceduralRoad();

	/** Spline that defines the centreline. Edit this to author the road by hand. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Road")
	TObjectPtr<USplineComponent> Centerline;

	/** Generated road surface. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Road")
	TObjectPtr<UProceduralMeshComponent> RoadMesh;

	// ---------------------------------------------------------------------
	// Shape
	// ---------------------------------------------------------------------

	/** Total width of the road surface, in centimetres. 1200 = 12 m. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Road", meta = (ClampMin = "100.0", UIMax = "4000.0"))
	float RoadWidth = 1200.0f;

	/** Number of segments along the swept mesh. Higher = smoother, more triangles. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Road|Shape", meta = (ClampMin = "8", UIMax = "2000"))
	int32 NumSegments = 512;

	/** Extra subdivision between each pair of profile points, across the road. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Road|Shape", meta = (ClampMin = "1", UIMax = "16"))
	int32 LateralSubdivisions = 4;

	/** How far the surface texture repeats along the road, in centimetres. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Road|Shape", meta = (ClampMin = "50.0"))
	float UVTiling = 1200.0f;

	/** Cross-section, left edge (-0.5) to right edge (+0.5). The default crowns
	 *  the middle of the road so water drains to the sides. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Road|Shape")
	TArray<FTDCRoadProfilePoint> RoadProfile;

	/** Closed circuit (true) or a length of open road (false). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Road|Shape")
	bool bClosedLoop = false;

	/** Flip the triangle winding if the road renders inside-out or unlit. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Road|Shape")
	bool bFlipWinding = false;

	// ---------------------------------------------------------------------
	// Banking
	// ---------------------------------------------------------------------

	/** Hard limit on bank angle, in degrees. The road rolls into corners up to
	 *  this much, and the roll comes from the measured curvature. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Road", meta = (ClampMin = "0.0", UIMax = "30.0"))
	float BankDegrees = 12.0f;

	/** How strongly curvature rolls the road. Larger = reaches BankDegrees on
	 *  gentler curves. Only the clamp keeps it sane. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Road|Banking", meta = (ClampMin = "0.0"))
	float BankingScale = 4000.0f;

	// ---------------------------------------------------------------------
	// Open-road generator (BuildStraightRoad)
	// ---------------------------------------------------------------------

	/** Length of the generated open road, in centimetres. 18000 = 180 m. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Road", meta = (ClampMin = "1000.0"))
	float RoadLength = 18000.0f;

	/** Distance between control points on the generated open road, in cm. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Road", meta = (ClampMin = "10.0"))
	float SampleSpacing = 100.0f;

	/** Lateral wander of the generated open road, in centimetres. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Road", meta = (ClampMin = "0.0"))
	float CurveAmplitude = 1700.0f;

	/** Vertical amplitude of the generated open road, in centimetres. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Road", meta = (ClampMin = "0.0"))
	float ElevationAmplitude = 900.0f;

	// ---------------------------------------------------------------------
	// Circuit generator (BuildDefaultCircuit)
	// ---------------------------------------------------------------------

	/** Rough radius of the generated circuit, in centimetres. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Road|Circuit", meta = (ClampMin = "1000.0"))
	float CircuitRadius = 60000.0f;

	/** Number of control points in the generated circuit. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Road|Circuit", meta = (ClampMin = "8", UIMax = "256"))
	int32 CircuitPoints = 28;

	/** 0 = perfect circle, 1 = very twisty. Drives the harmonic sum. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Road|Circuit", meta = (ClampMin = "0.0", UIMax = "1.0"))
	float Curvature = 0.28f;

	/** Randomisation seed for the generated circuit. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Road|Circuit")
	int32 CircuitSeed = 1337;

	// ---------------------------------------------------------------------
	// Render / collision
	// ---------------------------------------------------------------------

	/** Assign a wet asphalt material here. Lane markings belong in the material,
	 *  driven by the U coordinate (0 = left edge, 1 = right edge). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Road")
	TObjectPtr<UMaterialInterface> WetAsphaltMaterial;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Road")
	bool bCreateCollision = true;

	// ---------------------------------------------------------------------
	// API
	// ---------------------------------------------------------------------

	/** Regenerate the road mesh from the current spline and settings. */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Road")
	void RebuildRoad();

	/** Generate the open road described by RoadLength / CurveAmplitude /
	 *  ElevationAmplitude and rebuild. This is the original starter layout. */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Road")
	void BuildStraightRoad();

	/** Discard the spline and generate a fresh closed circuit. */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Road")
	void BuildDefaultCircuit();

	/** Total length of the centreline, in centimetres. */
	UFUNCTION(BlueprintPure, Category = "Road")
	float GetTrackLength() const;

	/** Project a world location onto the centreline. OutDistanceAlongTrack is in
	 *  cm; OutLateralOffset is signed cm (+ = right of the centreline). */
	UFUNCTION(BlueprintCallable, Category = "Road")
	void ProjectOntoTrack(const FVector& WorldLocation, float& OutDistanceAlongTrack, float& OutLateralOffset) const;

protected:
	virtual void OnConstruction(const FTransform& Transform) override;
	virtual void BeginPlay() override;

#if WITH_EDITOR
	virtual void PostEditChangeProperty(struct FPropertyChangedEvent& PropertyChangedEvent) override;
#endif
};
