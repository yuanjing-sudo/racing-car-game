#include "TDCProceduralRoad.h"

#include "Components/SplineComponent.h"
#include "ProceduralMeshComponent.h"
#include "KismetProceduralMeshLibrary.h"
#include "Materials/MaterialInterface.h"
#include "Math/RandomStream.h"

ATDCProceduralRoad::ATDCProceduralRoad()
{
	PrimaryActorTick.bCanEverTick = false;

	Centerline = CreateDefaultSubobject<USplineComponent>(TEXT("Centerline"));
	SetRootComponent(Centerline);
	Centerline->SetMobility(EComponentMobility::Movable);
	Centerline->SetClosedLoop(false);
	Centerline->UpdateSpline();

	RoadMesh = CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("RoadSurface"));
	RoadMesh->SetupAttachment(Centerline);
	RoadMesh->SetMobility(EComponentMobility::Movable);
	RoadMesh->bUseAsyncCooking = true;
	RoadMesh->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
	RoadMesh->SetCollisionObjectType(ECC_WorldStatic);
	RoadMesh->SetCollisionResponseToAllChannels(ECR_Block);
	RoadMesh->SetCastShadow(true);

	// A gentle crown so the middle of the road sits ~4 cm proud of the edges,
	// which is what real roads do for drainage. Built field-by-field rather
	// than with brace initialisation: GENERATED_BODY() structs are not
	// guaranteed to remain C++ aggregates.
	RoadProfile.Reset();
	const auto AddProfilePoint = [this](float InLateralFraction, float InHeightOffset)
	{
		FTDCRoadProfilePoint Point;
		Point.LateralFraction = InLateralFraction;
		Point.HeightOffset = InHeightOffset;
		RoadProfile.Add(Point);
	};
	AddProfilePoint(-0.5f, -4.0f);
	AddProfilePoint(-0.25f, -1.0f);
	AddProfilePoint(0.0f, 0.0f);
	AddProfilePoint(0.25f, -1.0f);
	AddProfilePoint(0.5f, -4.0f);
}

void ATDCProceduralRoad::OnConstruction(const FTransform& Transform)
{
	Super::OnConstruction(Transform);

	// First time the actor is placed there is no centreline yet, so lay down
	// the open road described by the RoadLength settings before sweeping.
	if (Centerline && Centerline->GetNumberOfSplinePoints() < 2)
	{
		BuildStraightRoad();
		return;
	}

	RebuildRoad();
}

void ATDCProceduralRoad::BeginPlay()
{
	Super::BeginPlay();
	RebuildRoad();
}

#if WITH_EDITOR
void ATDCProceduralRoad::PostEditChangeProperty(FPropertyChangedEvent& PropertyChangedEvent)
{
	Super::PostEditChangeProperty(PropertyChangedEvent);

	// Live-update the mesh while the artist drags sliders in the details panel.
	RebuildRoad();
}
#endif

float ATDCProceduralRoad::GetTrackLength() const
{
	return Centerline ? Centerline->GetSplineLength() : 0.0f;
}

void ATDCProceduralRoad::ProjectOntoTrack(const FVector& WorldLocation, float& OutDistanceAlongTrack, float& OutLateralOffset) const
{
	OutDistanceAlongTrack = 0.0f;
	OutLateralOffset = 0.0f;

	if (!Centerline)
	{
		return;
	}

	const FVector Closest = Centerline->FindLocationClosestToWorldLocation(WorldLocation, ESplineCoordinateSpace::World);
	OutDistanceAlongTrack = Centerline->GetDistanceAlongSplineAtLocation(Closest, ESplineCoordinateSpace::World);

	const FVector Right = Centerline->GetRightVectorAtDistanceAlongSpline(OutDistanceAlongTrack, ESplineCoordinateSpace::World);
	OutLateralOffset = FVector::DotProduct(WorldLocation - Closest, Right);
}

void ATDCProceduralRoad::BuildStraightRoad()
{
	if (!Centerline)
	{
		return;
	}

	Centerline->ClearSplinePoints(false);

	const int32 NumPoints = FMath::Max(20, FMath::CeilToInt(RoadLength / FMath::Max(10.0f, SampleSpacing)));

	// Same shape as the original starter: a road running along +X that wanders
	// laterally and rises and falls, both as smooth sine functions of distance
	// so the curve is continuous and has no kinks.
	for (int32 i = 0; i <= NumPoints; ++i)
	{
		const float Distance = RoadLength * static_cast<float>(i) / static_cast<float>(NumPoints);
		const float T = (Distance / FMath::Max(1.0f, RoadLength)) * 2.0f * PI;

		const float Y = CurveAmplitude * 0.45f * FMath::Sin(T);
		const float Z = ElevationAmplitude * FMath::Sin(T)
			+ ElevationAmplitude * 0.24f * FMath::Sin(2.0f * T + 0.6f);

		Centerline->AddSplinePoint(FVector(Distance, Y, Z), ESplineCoordinateSpace::World, false);
	}

	Centerline->SetClosedLoop(false, false);
	Centerline->UpdateSpline();

	RebuildRoad();
}

void ATDCProceduralRoad::BuildDefaultCircuit()
{
	if (!Centerline)
	{
		return;
	}

	Centerline->ClearSplinePoints(false);

	const int32 NumPoints = FMath::Max(8, CircuitPoints);

	// Deterministic phase offsets so a given seed always produces the same track.
	FRandomStream Stream(CircuitSeed);
	const float Phase3 = Stream.FRandRange(0.0f, 2.0f * PI);
	const float Phase5 = Stream.FRandRange(0.0f, 2.0f * PI);
	const float PhaseZ = Stream.FRandRange(0.0f, 2.0f * PI);

	for (int32 i = 0; i < NumPoints; ++i)
	{
		const float Angle = 2.0f * PI * static_cast<float>(i) / static_cast<float>(NumPoints);

		// Integer harmonics keep the loop seamless and prevent the self-
		// intersection / zero-radius cusps you get from arbitrary wiggles.
		float Radius = CircuitRadius;
		Radius += CircuitRadius * Curvature * FMath::Sin(3.0f * Angle + Phase3);
		Radius += CircuitRadius * 0.5f * Curvature * FMath::Sin(5.0f * Angle + Phase5);

		const float Z = ElevationAmplitude * FMath::Sin(2.0f * Angle + PhaseZ)
			+ ElevationAmplitude * 0.35f * FMath::Sin(4.0f * Angle);

		Centerline->AddSplinePoint(
			FVector(FMath::Cos(Angle) * Radius, FMath::Sin(Angle) * Radius, Z),
			ESplineCoordinateSpace::World,
			false);
	}

	Centerline->SetClosedLoop(true, false);
	Centerline->UpdateSpline();

	bClosedLoop = true;
	RebuildRoad();
}

void ATDCProceduralRoad::RebuildRoad()
{
	if (!Centerline || !RoadMesh)
	{
		return;
	}

	RoadMesh->ClearAllMeshSections();

	const int32 NumProfilePoints = RoadProfile.Num();
	if (NumProfilePoints < 2)
	{
		return;
	}

	// ---- Build the subdivided cross-section once -------------------------
	TArray<FTDCRoadProfilePoint> Cross;
	{
		const int32 Steps = FMath::Max(1, LateralSubdivisions);
		Cross.Reserve((NumProfilePoints - 1) * Steps + 1);
		for (int32 p = 0; p < NumProfilePoints - 1; ++p)
		{
			const FTDCRoadProfilePoint& A = RoadProfile[p];
			const FTDCRoadProfilePoint& B = RoadProfile[p + 1];
			for (int32 k = 0; k < Steps; ++k)
			{
				const float T = static_cast<float>(k) / static_cast<float>(Steps);
				FTDCRoadProfilePoint P;
				P.LateralFraction = FMath::Lerp(A.LateralFraction, B.LateralFraction, T);
				P.HeightOffset = FMath::Lerp(A.HeightOffset, B.HeightOffset, T);
				Cross.Add(P);
			}
		}
		Cross.Add(RoadProfile.Last());
	}

	const int32 CrossCount = Cross.Num();
	const int32 NumAlong = FMath::Max(2, NumSegments);
	const int32 RowCount = NumAlong + 1;

	const float TotalLength = Centerline->GetSplineLength();
	if (TotalLength <= KINDA_SMALL_NUMBER)
	{
		return;
	}

	// Sample step used for the curvature estimate behind the banking.
	const float CurvatureStep = FMath::Max(1.0f, TotalLength / (static_cast<float>(NumAlong) * 4.0f));
	const float MaxBankRad = FMath::DegreesToRadians(FMath::Max(0.0f, BankDegrees));

	TArray<FVector> Vertices;
	TArray<int32> Triangles;
	TArray<FVector2D> UVs;
	Vertices.Reserve(RowCount * CrossCount);
	UVs.Reserve(RowCount * CrossCount);
	Triangles.Reserve((RowCount - 1) * (CrossCount - 1) * 6);

	const auto WrapDistance = [TotalLength](float Distance)
	{
		if (TotalLength <= KINDA_SMALL_NUMBER)
		{
			return 0.0f;
		}
		float Wrapped = FMath::Fmod(Distance, TotalLength);
		if (Wrapped < 0.0f)
		{
			Wrapped += TotalLength;
		}
		return Wrapped;
	};

	for (int32 Row = 0; Row < RowCount; ++Row)
	{
		const float Alpha = static_cast<float>(Row) / static_cast<float>(NumAlong);
		const float Dist = Alpha * TotalLength;
		const float ClampedDist = FMath::Clamp(Dist, 0.0f, TotalLength);

		const FVector Location = Centerline->GetLocationAtDistanceAlongSpline(ClampedDist, ESplineCoordinateSpace::World);
		const FVector Tangent = Centerline->GetTangentAtDistanceAlongSpline(ClampedDist, ESplineCoordinateSpace::World).GetSafeNormal();

		FVector Right = FVector::CrossProduct(Tangent, FVector::UpVector).GetSafeNormal();
		if (Right.IsNearlyZero())
		{
			Right = FVector::CrossProduct(Tangent, FVector::ForwardVector).GetSafeNormal();
		}

		// ---- Banking from curvature -------------------------------------
		float BankAngle = 0.0f;
		if (BankingScale > 0.0f && MaxBankRad > 0.0f)
		{
			const FVector AheadTangent = Centerline->GetTangentAtDistanceAlongSpline(
				WrapDistance(Dist + CurvatureStep), ESplineCoordinateSpace::World).GetSafeNormal();
			const FVector BehindTangent = Centerline->GetTangentAtDistanceAlongSpline(
				WrapDistance(Dist - CurvatureStep), ESplineCoordinateSpace::World).GetSafeNormal();

			const FVector TangentDerivative = (AheadTangent - BehindTangent) / (2.0f * CurvatureStep);
			const float SignedCurvature = FVector::DotProduct(TangentDerivative, Right);

			// Negative sign: turning left raises the right-hand edge.
			BankAngle = FMath::Clamp(-SignedCurvature * BankingScale, -MaxBankRad, MaxBankRad);
		}

		const float CosB = FMath::Cos(BankAngle);
		const float SinB = FMath::Sin(BankAngle);
		const FVector BankedRight = Right * CosB + FVector::UpVector * SinB;
		const FVector BankedUp = FVector::UpVector * CosB - Right * SinB;

		const float V = Dist / FMath::Max(50.0f, UVTiling);

		for (int32 Column = 0; Column < CrossCount; ++Column)
		{
			const FTDCRoadProfilePoint& P = Cross[Column];
			const FVector Position = Location
				+ BankedRight * (P.LateralFraction * RoadWidth)
				+ BankedUp * P.HeightOffset;

			Vertices.Add(Position);
			UVs.Add(FVector2D(P.LateralFraction + 0.5f, V));
		}
	}

	// ---- Triangulate -----------------------------------------------------
	for (int32 Row = 0; Row < RowCount - 1; ++Row)
	{
		for (int32 Column = 0; Column < CrossCount - 1; ++Column)
		{
			const int32 I0 = Row * CrossCount + Column;
			const int32 I1 = I0 + 1;
			const int32 I2 = (Row + 1) * CrossCount + Column;
			const int32 I3 = I2 + 1;

			if (!bFlipWinding)
			{
				Triangles.Add(I0); Triangles.Add(I1); Triangles.Add(I3);
				Triangles.Add(I0); Triangles.Add(I3); Triangles.Add(I2);
			}
			else
			{
				Triangles.Add(I0); Triangles.Add(I3); Triangles.Add(I1);
				Triangles.Add(I0); Triangles.Add(I2); Triangles.Add(I3);
			}
		}
	}

	// ---- Normals / tangents / upload ------------------------------------
	TArray<FVector> Normals;
	TArray<FProcMeshTangent> Tangents;
	UKismetProceduralMeshLibrary::CalculateTangentsForMesh(Vertices, Triangles, UVs, Normals, Tangents);

	TArray<FLinearColor> Colors;
	Colors.Init(FLinearColor::White, Vertices.Num());

	RoadMesh->CreateMeshSection_LinearColor(
		0, Vertices, Triangles, Normals, UVs, Colors, Tangents, bCreateCollision);

	if (WetAsphaltMaterial)
	{
		RoadMesh->SetMaterial(0, WetAsphaltMaterial);
	}
}
