#include "TDCWorldLandmarks.h"

#include "Components/PointLightComponent.h"
#include "Components/RectLightComponent.h"
#include "Components/SceneComponent.h"
#include "Engine/Scene.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Math/RandomStream.h"
#include "ProceduralMeshComponent.h"

namespace
{
	constexpr float Pi = 3.14159265358979f;

	// Palette. These are linear colours fed to the engine's basic shape material;
	// the golden-hour light rig does the rest.
	const FLinearColor TowerOrangeColor(1.00f, 0.235f, 0.035f);
	const FLinearColor TowerWhiteColor(0.90f, 0.88f, 0.82f);
	const FLinearColor ConcreteColor(0.105f, 0.115f, 0.135f);
	const FLinearColor WindowColor(1.00f, 0.62f, 0.28f);
	const FLinearColor NeonPinkColor(1.00f, 0.08f, 0.42f);
	const FLinearColor NeonCyanColor(0.08f, 0.72f, 1.00f);
	const FLinearColor FujiColor(0.085f, 0.105f, 0.175f);
	const FLinearColor SnowColor(0.92f, 0.95f, 1.00f);
	const FLinearColor SteelColor(0.42f, 0.45f, 0.50f);
	const FLinearColor CableColor(0.30f, 0.32f, 0.35f);
	const FLinearColor ToriiColor(0.72f, 0.075f, 0.03f);

}

// ============================================================================
//  Mesh builder
// ============================================================================

void FTDCMeshBuilder::Reset()
{
	Vertices.Reset();
	Triangles.Reset();
	Normals.Reset();
	UVs.Reset();
}

int32 FTDCMeshBuilder::AddVertex(const FVector& Position, const FVector& Normal)
{
	Normals.Add(Normal);
	UVs.Add(FVector2D::ZeroVector);
	return Vertices.Add(Position);
}

void FTDCMeshBuilder::AddTriangle(const FVector& A, const FVector& B, const FVector& C, const FVector& Normal)
{
	const int32 IA = AddVertex(A, Normal);
	const int32 IB = AddVertex(B, Normal);
	const int32 IC = AddVertex(C, Normal);

	// Keep the winding consistent with the normal we supply; the caller is then
	// free to list corners in any order.
	if (FVector::DotProduct(FVector::CrossProduct(B - A, C - A), Normal) < 0.0f)
	{
		Triangles.Add(IA);
		Triangles.Add(IC);
		Triangles.Add(IB);
	}
	else
	{
		Triangles.Add(IA);
		Triangles.Add(IB);
		Triangles.Add(IC);
	}
}

void FTDCMeshBuilder::AddQuad(const FVector& A, const FVector& B, const FVector& C, const FVector& D, const FVector& Normal)
{
	// Same trick as AddTriangle, but for a quad: if the listed order faces away
	// from the normal, traverse the other way round.
	const bool bFlip = FVector::DotProduct(FVector::CrossProduct(B - A, D - A), Normal) < 0.0f;
	const FVector& Second = bFlip ? D : B;
	const FVector& Fourth = bFlip ? B : D;

	const int32 IA = AddVertex(A, Normal);
	const int32 IB = AddVertex(Second, Normal);
	const int32 IC = AddVertex(C, Normal);
	const int32 ID = AddVertex(Fourth, Normal);

	Triangles.Add(IA);
	Triangles.Add(IB);
	Triangles.Add(IC);
	Triangles.Add(IA);
	Triangles.Add(IC);
	Triangles.Add(ID);
}

void FTDCMeshBuilder::AddBox(const FVector& Centre, const FVector& Extent, const FRotator& Rotation)
{
	const FVector X = Rotation.RotateVector(FVector::ForwardVector) * Extent.X;
	const FVector Y = Rotation.RotateVector(FVector::RightVector) * Extent.Y;
	const FVector Z = Rotation.RotateVector(FVector::UpVector) * Extent.Z;

	FVector C[8];
	for (int32 i = 0; i < 8; ++i)
	{
		C[i] = Centre
			+ ((i & 1) ? X : -X)
			+ ((i & 2) ? Y : -Y)
			+ ((i & 4) ? Z : -Z);
	}

	const FVector NX = X.GetSafeNormal();
	const FVector NY = Y.GetSafeNormal();
	const FVector NZ = Z.GetSafeNormal();

	AddQuad(C[1], C[3], C[7], C[5], NX);
	AddQuad(C[0], C[4], C[6], C[2], -NX);
	AddQuad(C[2], C[6], C[7], C[3], NY);
	AddQuad(C[0], C[1], C[5], C[4], -NY);
	AddQuad(C[4], C[5], C[7], C[6], NZ);
	AddQuad(C[0], C[2], C[3], C[1], -NZ);
}

void FTDCMeshBuilder::AddBeam(const FVector& A, const FVector& B, float Thickness)
{
	const FVector Axis = B - A;
	const float Length = Axis.Size();
	if (Length < 1.0f)
	{
		return;
	}

	const FVector Direction = Axis / Length;
	const FVector Reference = FMath::Abs(Direction.Z) > 0.95f ? FVector::ForwardVector : FVector::UpVector;
	const FVector Right = FVector::CrossProduct(Direction, Reference).GetSafeNormal();
	const FVector Up = FVector::CrossProduct(Right, Direction).GetSafeNormal();

	const FVector H = Right * (Thickness * 0.5f);
	const FVector V = Up * (Thickness * 0.5f);

	FVector C[8];
	for (int32 i = 0; i < 8; ++i)
	{
		C[i] = ((i & 4) ? B : A)
			+ ((i & 1) ? H : -H)
			+ ((i & 2) ? V : -V);
	}

	AddQuad(C[1], C[3], C[7], C[5], Right);
	AddQuad(C[0], C[4], C[6], C[2], -Right);
	AddQuad(C[2], C[6], C[7], C[3], Up);
	AddQuad(C[0], C[1], C[5], C[4], -Up);
	AddQuad(C[4], C[5], C[7], C[6], Direction);
	AddQuad(C[0], C[2], C[3], C[1], -Direction);
}

void FTDCMeshBuilder::AddPrism(const FVector& Base, float BottomRadius, float TopRadius, float Height, int32 Sides, bool bTopCap, bool bBottomCap)
{
	Sides = FMath::Max(3, Sides);

	// Outward normal of a cone side: radial + a vertical term from the taper.
	const float Slope = (BottomRadius - TopRadius) / FMath::Max(1.0f, Height);

	for (int32 i = 0; i < Sides; ++i)
	{
		const float Angle0 = 2.0f * Pi * static_cast<float>(i) / static_cast<float>(Sides);
		const float Angle1 = 2.0f * Pi * static_cast<float>(i + 1) / static_cast<float>(Sides);

		const FVector Dir0(FMath::Cos(Angle0), FMath::Sin(Angle0), 0.0f);
		const FVector Dir1(FMath::Cos(Angle1), FMath::Sin(Angle1), 0.0f);

		const FVector B0 = Base + Dir0 * BottomRadius;
		const FVector B1 = Base + Dir1 * BottomRadius;
		const FVector T0 = Base + Dir0 * TopRadius + FVector(0.0f, 0.0f, Height);
		const FVector T1 = Base + Dir1 * TopRadius + FVector(0.0f, 0.0f, Height);

		const FVector N0 = (Dir0 + FVector(0.0f, 0.0f, Slope)).GetSafeNormal();
		const FVector N1 = (Dir1 + FVector(0.0f, 0.0f, Slope)).GetSafeNormal();

		AddQuad(B0, B1, T1, T0, (N0 + N1).GetSafeNormal());
	}

	if (bTopCap && TopRadius > 0.5f)
	{
		const FVector Centre = Base + FVector(0.0f, 0.0f, Height);
		for (int32 i = 0; i < Sides; ++i)
		{
			const float A0 = 2.0f * Pi * static_cast<float>(i) / static_cast<float>(Sides);
			const float A1 = 2.0f * Pi * static_cast<float>(i + 1) / static_cast<float>(Sides);
			const FVector P0 = Base + FVector(FMath::Cos(A0), FMath::Sin(A0), 0.0f) * TopRadius + FVector(0.0f, 0.0f, Height);
			const FVector P1 = Base + FVector(FMath::Cos(A1), FMath::Sin(A1), 0.0f) * TopRadius + FVector(0.0f, 0.0f, Height);
			AddTriangle(Centre, P0, P1, FVector::UpVector);
		}
	}

	if (bBottomCap && BottomRadius > 0.5f)
	{
		for (int32 i = 0; i < Sides; ++i)
		{
			const float A0 = 2.0f * Pi * static_cast<float>(i) / static_cast<float>(Sides);
			const float A1 = 2.0f * Pi * static_cast<float>(i + 1) / static_cast<float>(Sides);
			const FVector P0 = Base + FVector(FMath::Cos(A0), FMath::Sin(A0), 0.0f) * BottomRadius;
			const FVector P1 = Base + FVector(FMath::Cos(A1), FMath::Sin(A1), 0.0f) * BottomRadius;
			AddTriangle(Base, P0, P1, -FVector::UpVector);
		}
	}
}

void FTDCMeshBuilder::AddProfile(const FVector& Base, float Radius, float Height, int32 Sides, int32 Rings, float Exponent,
	float TMin, float TMax, float RadiusOffset)
{
	Sides = FMath::Max(3, Sides);
	Rings = FMath::Max(1, Rings);

	for (int32 Ring = 0; Ring < Rings; ++Ring)
	{
		const float T0 = FMath::Lerp(TMin, TMax, static_cast<float>(Ring) / static_cast<float>(Rings));
		const float T1 = FMath::Lerp(TMin, TMax, static_cast<float>(Ring + 1) / static_cast<float>(Rings));

		const float Y0 = Height * T0;
		const float Y1 = Height * T1;
		const float R0 = Radius * FMath::Pow(FMath::Max(0.0f, 1.0f - T0), Exponent) + RadiusOffset;
		const float R1 = Radius * FMath::Pow(FMath::Max(0.0f, 1.0f - T1), Exponent) + RadiusOffset;

		// dR/dt of the profile, for the normal.
		const float DR0 = -Radius * Exponent * FMath::Pow(FMath::Max(0.0001f, 1.0f - T0), Exponent - 1.0f);
		const float DR1 = -Radius * Exponent * FMath::Pow(FMath::Max(0.0001f, 1.0f - T1), Exponent - 1.0f);

		for (int32 i = 0; i < Sides; ++i)
		{
			const float A0 = 2.0f * Pi * static_cast<float>(i) / static_cast<float>(Sides);
			const float A1 = 2.0f * Pi * static_cast<float>(i + 1) / static_cast<float>(Sides);

			const FVector Dir0(FMath::Cos(A0), FMath::Sin(A0), 0.0f);
			const FVector Dir1(FMath::Cos(A1), FMath::Sin(A1), 0.0f);

			const FVector P00 = Base + Dir0 * R0 + FVector(0.0f, 0.0f, Y0);
			const FVector P01 = Base + Dir1 * R0 + FVector(0.0f, 0.0f, Y0);
			const FVector P10 = Base + Dir0 * R1 + FVector(0.0f, 0.0f, Y1);
			const FVector P11 = Base + Dir1 * R1 + FVector(0.0f, 0.0f, Y1);

			const FVector N0 = FVector(Dir0.X * Height, Dir0.Y * Height, -DR0).GetSafeNormal();
			const FVector N1 = FVector(Dir1.X * Height, Dir1.Y * Height, -DR1).GetSafeNormal();

			AddQuad(P00, P01, P11, P10, (N0 + N1).GetSafeNormal());
		}
	}
}

// ============================================================================
//  Actor
// ============================================================================

ATDCWorldLandmarks::ATDCWorldLandmarks()
{
	PrimaryActorTick.bCanEverTick = false;

	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	RootComponent = Root;

	TowerOrangePart = CreatePart(TEXT("TowerOrange"));
	TowerWhitePart = CreatePart(TEXT("TowerWhite"));
	ConcretePart = CreatePart(TEXT("Concrete"));
	WindowsPart = CreatePart(TEXT("Windows"));
	NeonPinkPart = CreatePart(TEXT("NeonPink"));
	NeonCyanPart = CreatePart(TEXT("NeonCyan"));
	FujiBodyPart = CreatePart(TEXT("FujiBody"));
	FujiSnowPart = CreatePart(TEXT("FujiSnow"));
	SteelPart = CreatePart(TEXT("Steel"));
	CablesPart = CreatePart(TEXT("Cables"));
	ToriiPart = CreatePart(TEXT("Torii"));
}

UProceduralMeshComponent* ATDCWorldLandmarks::CreatePart(const FName& Name)
{
	UProceduralMeshComponent* Part = CreateDefaultSubobject<UProceduralMeshComponent>(Name);
	Part->SetupAttachment(Root);
	// Runtime-spawned actors may only own movable components.
	Part->SetMobility(EComponentMobility::Movable);
	Part->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Part->SetCastShadow(true);
	Part->bUseAsyncCooking = false;
	return Part;
}

void ATDCWorldLandmarks::OnConstruction(const FTransform& Transform)
{
	Super::OnConstruction(Transform);

	if (bBuildOnConstruction)
	{
		BuildWorld();
	}
}

void ATDCWorldLandmarks::BeginPlay()
{
	Super::BeginPlay();

	if (!bBuildOnConstruction)
	{
		BuildWorld();
	}
}

void ATDCWorldLandmarks::ClearWorld()
{
	UProceduralMeshComponent* Parts[] =
	{
		TowerOrangePart, TowerWhitePart, ConcretePart, WindowsPart, NeonPinkPart,
		NeonCyanPart, FujiBodyPart, FujiSnowPart, SteelPart, CablesPart, ToriiPart
	};

	for (UProceduralMeshComponent* Part : Parts)
	{
		if (Part)
		{
			Part->ClearAllMeshSections();
		}
	}

	for (UActorComponent* Light : GeneratedLights)
	{
		if (Light)
		{
			Light->DestroyComponent();
		}
	}

	GeneratedLights.Reset();
	Materials.Reset();
	Landmarks.Reset();
	TriangleCount = 0;
	NeonLightsPlaced = 0;
	BeaconLightsPlaced = 0;

	OrangeMesh.Reset();
	WhiteMesh.Reset();
	ConcreteMesh.Reset();
	WindowMesh.Reset();
	PinkMesh.Reset();
	CyanMesh.Reset();
	FujiMesh.Reset();
	SnowMesh.Reset();
	SteelMesh.Reset();
	CableMesh.Reset();
	ToriiMesh.Reset();
}

UMaterialInstanceDynamic* ATDCWorldLandmarks::MakeMaterial(const FLinearColor& Color)
{
	if (!BaseMaterial)
	{
		return nullptr;
	}

	UMaterialInstanceDynamic* Material = UMaterialInstanceDynamic::Create(BaseMaterial, this);
	if (Material)
	{
		// BasicShapeMaterial exposes a single "Color" vector parameter.
		Material->SetVectorParameterValue(TEXT("Color"), Color);
		Materials.Add(Material);
	}

	return Material;
}

void ATDCWorldLandmarks::BuildWorld()
{
	ClearWorld();

	BaseMaterial = LoadObject<UMaterialInterface>(nullptr, TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));

	OrangeMaterial = MakeMaterial(TowerOrangeColor);
	WhiteMaterial = MakeMaterial(TowerWhiteColor);
	ConcreteMaterial = MakeMaterial(ConcreteColor);
	WindowMaterial = MakeMaterial(WindowColor);
	PinkMaterial = MakeMaterial(NeonPinkColor);
	CyanMaterial = MakeMaterial(NeonCyanColor);
	FujiMaterial = MakeMaterial(FujiColor);
	SnowMaterial = MakeMaterial(SnowColor);
	SteelMaterial = MakeMaterial(SteelColor);
	CableMaterial = MakeMaterial(CableColor);
	ToriiMaterial = MakeMaterial(ToriiColor);

	if (bBuildTokyoTower)
	{
		BuildTokyoTower();
	}

	if (bBuildSkytree)
	{
		BuildSkytree();
	}

	if (bBuildFuji)
	{
		BuildFuji();
	}

	if (bBuildRainbowBridge)
	{
		BuildRainbowBridge();
	}

	if (bBuildTorii)
	{
		BuildTorii();
	}

	if (bBuildSkyline)
	{
		BuildSkyline();
	}

	ApplyAll();
}

void ATDCWorldLandmarks::ApplyAll()
{
	// Count before clearing the accumulators.
	TriangleCount =
		(OrangeMesh.Triangles.Num()
			+ WhiteMesh.Triangles.Num()
			+ ConcreteMesh.Triangles.Num()
			+ WindowMesh.Triangles.Num()
			+ PinkMesh.Triangles.Num()
			+ CyanMesh.Triangles.Num()
			+ FujiMesh.Triangles.Num()
			+ SnowMesh.Triangles.Num()
			+ SteelMesh.Triangles.Num()
			+ CableMesh.Triangles.Num()
			+ ToriiMesh.Triangles.Num()) / 3;

	ApplyMesh(TowerOrangePart, OrangeMesh);
	ApplyMesh(TowerWhitePart, WhiteMesh);
	ApplyMesh(ConcretePart, ConcreteMesh);
	ApplyMesh(WindowsPart, WindowMesh);
	ApplyMesh(NeonPinkPart, PinkMesh);
	ApplyMesh(NeonCyanPart, CyanMesh);
	ApplyMesh(FujiBodyPart, FujiMesh);
	ApplyMesh(FujiSnowPart, SnowMesh);
	ApplyMesh(SteelPart, SteelMesh);
	ApplyMesh(CablesPart, CableMesh);
	ApplyMesh(ToriiPart, ToriiMesh);

	if (TowerOrangePart) { TowerOrangePart->SetMaterial(0, OrangeMaterial); }
	if (TowerWhitePart) { TowerWhitePart->SetMaterial(0, WhiteMaterial); }
	if (ConcretePart) { ConcretePart->SetMaterial(0, ConcreteMaterial); }
	if (WindowsPart) { WindowsPart->SetMaterial(0, WindowMaterial); }
	if (NeonPinkPart) { NeonPinkPart->SetMaterial(0, PinkMaterial); }
	if (NeonCyanPart) { NeonCyanPart->SetMaterial(0, CyanMaterial); }
	if (FujiBodyPart) { FujiBodyPart->SetMaterial(0, FujiMaterial); }
	if (FujiSnowPart) { FujiSnowPart->SetMaterial(0, SnowMaterial); }
	if (SteelPart) { SteelPart->SetMaterial(0, SteelMaterial); }
	if (CablesPart) { CablesPart->SetMaterial(0, CableMaterial); }
	if (ToriiPart) { ToriiPart->SetMaterial(0, ToriiMaterial); }

	// Geometry is uploaded; free the scratch buffers.
	OrangeMesh.Reset();
	WhiteMesh.Reset();
	ConcreteMesh.Reset();
	WindowMesh.Reset();
	PinkMesh.Reset();
	CyanMesh.Reset();
	FujiMesh.Reset();
	SnowMesh.Reset();
	SteelMesh.Reset();
	CableMesh.Reset();
	ToriiMesh.Reset();
}

void ATDCWorldLandmarks::ApplyMesh(UProceduralMeshComponent* Part, const FTDCMeshBuilder& Builder)
{
	if (!Part)
	{
		return;
	}

	Part->ClearAllMeshSections();
	Part->SetVisibility(!Builder.IsEmpty(), true);

	if (Builder.IsEmpty())
	{
		return;
	}

	Part->CreateMeshSection_LinearColor(
		0,
		Builder.Vertices,
		Builder.Triangles,
		Builder.Normals,
		Builder.UVs,
		TArray<FLinearColor>(),
		TArray<FProcMeshTangent>(),
		false);
}

void ATDCWorldLandmarks::AddPointLight(const FVector& RelativeLocation, const FLinearColor& Color, float Intensity, float Radius)
{
	UPointLightComponent* Light = NewObject<UPointLightComponent>(this);
	if (!Light)
	{
		return;
	}

	Light->SetMobility(EComponentMobility::Movable);
	Light->SetupAttachment(Root);
	AddInstanceComponent(Light);
	GeneratedLights.Add(Light);
	Light->RegisterComponent();

	Light->SetRelativeLocation(RelativeLocation);
	Light->SetIntensityUnits(ELightUnits::Candelas);
	Light->SetIntensity(Intensity);
	Light->SetLightColor(Color);
	Light->SetAttenuationRadius(Radius);
	Light->SetCastShadows(false);
}

void ATDCWorldLandmarks::AddRectLight(const FVector& RelativeLocation, const FRotator& RelativeRotation, const FLinearColor& Color, float Width, float Height, float Intensity)
{
	URectLightComponent* Light = NewObject<URectLightComponent>(this);
	if (!Light)
	{
		return;
	}

	Light->SetMobility(EComponentMobility::Movable);
	Light->SetupAttachment(Root);
	AddInstanceComponent(Light);
	GeneratedLights.Add(Light);
	Light->RegisterComponent();

	Light->SetRelativeLocation(RelativeLocation);
	Light->SetRelativeRotation(RelativeRotation);
	Light->SetSourceWidth(Width);
	Light->SetSourceHeight(Height);
	Light->SetIntensity(Intensity);
	Light->SetLightColor(Color);
	Light->SetAttenuationRadius(FMath::Max(Width, Height) * 6.0f);
	Light->SetCastShadows(false);
}

void ATDCWorldLandmarks::AddLandmark(const FString& Name, const FVector& RelativeLocation, float Height)
{
	FTDCLandmarkInfo& Info = Landmarks.AddDefaulted_GetRef();
	Info.Name = Name;
	Info.Location = RelativeLocation;
	Info.Height = Height;
}

FString ATDCWorldLandmarks::GetLandmarkName(int32 Index) const
{
	return Landmarks.IsValidIndex(Index) ? Landmarks[Index].Name : FString();
}

FVector ATDCWorldLandmarks::GetLandmarkLocation(int32 Index) const
{
	if (!Landmarks.IsValidIndex(Index))
	{
		return GetActorLocation();
	}

	return GetActorTransform().TransformPosition(Landmarks[Index].Location);
}

// ============================================================================
//  Tokyo Tower
// ============================================================================

void ATDCWorldLandmarks::BuildTokyoTower()
{
	const FVector Base(150000.0f, -90000.0f, 0.0f);
	const float LatticeTop = 25000.0f;
	const float TotalHeight = 33300.0f;
	const float BaseHalf = 4200.0f;
	const float WaistHalf = 950.0f;
	const int32 Levels = 12;

	const FVector2D Corners[4] = {
		FVector2D(1.0f, 1.0f),
		FVector2D(-1.0f, 1.0f),
		FVector2D(-1.0f, -1.0f),
		FVector2D(1.0f, -1.0f)
	};

	// The real tower's silhouette is a gentle concave taper, not a cone.
	auto HalfAt = [&](float T)
	{
		return FMath::Lerp(BaseHalf, WaistHalf, FMath::Pow(FMath::Clamp(T, 0.0f, 1.0f), 0.85f));
	};

	// Four legs, bottom to the 250 m waist.
	for (int32 Corner = 0; Corner < 4; ++Corner)
	{
		const FVector Bottom = Base + FVector(Corners[Corner].X * BaseHalf, Corners[Corner].Y * BaseHalf, 0.0f);
		const FVector Top = Base + FVector(Corners[Corner].X * WaistHalf, Corners[Corner].Y * WaistHalf, LatticeTop);
		OrangeMesh.AddBeam(Bottom, Top, 260.0f);
	}

	// Horizontal rings and X-bracing. Every third ring is painted white, which is
	// what gives the tower its banded read at distance.
	for (int32 Level = 0; Level <= Levels; ++Level)
	{
		const float T = static_cast<float>(Level) / static_cast<float>(Levels);
		const float Half = HalfAt(T);
		const float Z = LatticeTop * T;

		for (int32 Corner = 0; Corner < 4; ++Corner)
		{
			const int32 Next = (Corner + 1) % 4;
			const FVector A = Base + FVector(Corners[Corner].X * Half, Corners[Corner].Y * Half, Z);
			const FVector B = Base + FVector(Corners[Next].X * Half, Corners[Next].Y * Half, Z);

			if (Level % 3 == 0)
			{
				WhiteMesh.AddBeam(A, B, 130.0f);
			}
			else
			{
				OrangeMesh.AddBeam(A, B, 110.0f);
			}
		}

		if (Level < Levels)
		{
			const float T1 = static_cast<float>(Level + 1) / static_cast<float>(Levels);
			const float Half1 = HalfAt(T1);
			const float Z1 = LatticeTop * T1;

			for (int32 Corner = 0; Corner < 4; ++Corner)
			{
				const int32 Next = (Corner + 1) % 4;
				const FVector A = Base + FVector(Corners[Corner].X * Half, Corners[Corner].Y * Half, Z);
				const FVector B = Base + FVector(Corners[Next].X * Half1, Corners[Next].Y * Half1, Z1);
				OrangeMesh.AddBeam(A, B, 85.0f);

				const FVector A2 = Base + FVector(Corners[Next].X * Half, Corners[Next].Y * Half, Z);
				const FVector B2 = Base + FVector(Corners[Corner].X * Half1, Corners[Corner].Y * Half1, Z1);
				OrangeMesh.AddBeam(A2, B2, 85.0f);
			}
		}
	}

	// Main deck (150 m) and top deck (250 m). A thin warm band reads as glazing.
	const FVector MainDeck = Base + FVector(0.0f, 0.0f, 15000.0f);
	WhiteMesh.AddBox(MainDeck, FVector(2800.0f, 2800.0f, 420.0f));
	WindowMesh.AddBox(MainDeck + FVector(0.0f, 0.0f, 120.0f), FVector(2810.0f, 2810.0f, 90.0f));
	SteelMesh.AddBox(MainDeck + FVector(0.0f, 0.0f, -330.0f), FVector(2400.0f, 2400.0f, 110.0f));

	const FVector TopDeck = Base + FVector(0.0f, 0.0f, 25000.0f);
	WhiteMesh.AddBox(TopDeck, FVector(2050.0f, 2050.0f, 360.0f));
	WindowMesh.AddBox(TopDeck + FVector(0.0f, 0.0f, 90.0f), FVector(2060.0f, 2060.0f, 80.0f));

	// Upper mast: a tapered prism to the 333 m tip, then the antenna spire.
	WhiteMesh.AddPrism(Base + FVector(0.0f, 0.0f, LatticeTop), 780.0f, 420.0f, 3000.0f, 24);
	OrangeMesh.AddPrism(Base + FVector(0.0f, 0.0f, 28000.0f), 420.0f, 140.0f, 3600.0f, 16);
	SteelMesh.AddPrism(Base + FVector(0.0f, 0.0f, 31600.0f), 120.0f, 18.0f, TotalHeight - 31600.0f, 8);

	// Aviation lights: red at the decks and the tip, the strongest at the top.
	AddPointLight(Base + FVector(0.0f, 0.0f, TotalHeight + 100.0f), FLinearColor(1.0f, 0.06f, 0.02f), 2400.0f, 6000.0f);
	AddPointLight(Base + FVector(2600.0f, 2600.0f, 15100.0f), FLinearColor(1.0f, 0.08f, 0.03f), 900.0f, 2600.0f);
	AddPointLight(Base + FVector(-2600.0f, -2600.0f, 15100.0f), FLinearColor(1.0f, 0.08f, 0.03f), 900.0f, 2600.0f);
	AddPointLight(Base + FVector(0.0f, 0.0f, 25100.0f), FLinearColor(1.0f, 0.08f, 0.03f), 1200.0f, 3200.0f);

	// Warm deck glow, so the tower reads as inhabited from the far side of the bay.
	AddPointLight(MainDeck + FVector(0.0f, 0.0f, 500.0f), FLinearColor(1.0f, 0.62f, 0.28f), 1800.0f, 3400.0f);

	AddLandmark(TEXT("TOKYO TOWER"), Base, TotalHeight);
}

// ============================================================================
//  Tokyo Skytree
// ============================================================================

void ATDCWorldLandmarks::BuildSkytree()
{
	const FVector Base(-520000.0f, 400000.0f, 0.0f);
	const float TotalHeight = 63400.0f;

	// Three tapering segments and the antenna. The real tower's lattice is far
	// denser; at five kilometres this silhouette is what the eye keeps.
	WhiteMesh.AddPrism(Base, 3600.0f, 1750.0f, 26000.0f, 24);
	WhiteMesh.AddPrism(Base + FVector(0.0f, 0.0f, 26000.0f), 1750.0f, 980.0f, 15000.0f, 24);
	WhiteMesh.AddPrism(Base + FVector(0.0f, 0.0f, 41000.0f), 980.0f, 320.0f, 19000.0f, 20);
	SteelMesh.AddPrism(Base + FVector(0.0f, 0.0f, 60000.0f), 160.0f, 16.0f, TotalHeight - 60000.0f, 8);

	// Support rings: a thin disc at each service level.
	for (int32 i = 1; i <= 7; ++i)
	{
		const float Z = 4000.0f * static_cast<float>(i);
		const float T = Z / 26000.0f;
		const float Radius = FMath::Lerp(3600.0f, 1750.0f, T);
		SteelMesh.AddPrism(Base + FVector(0.0f, 0.0f, Z), Radius + 140.0f, Radius + 140.0f, 180.0f, 24);
	}

	// Tembo Deck (350 m) and Tembo Galleria (450 m).
	const FVector DeckA = Base + FVector(0.0f, 0.0f, 35000.0f);
	WhiteMesh.AddBox(DeckA, FVector(2300.0f, 2300.0f, 420.0f));
	WindowMesh.AddBox(DeckA + FVector(0.0f, 0.0f, 90.0f), FVector(2310.0f, 2310.0f, 90.0f));

	const FVector DeckB = Base + FVector(0.0f, 0.0f, 45000.0f);
	WhiteMesh.AddBox(DeckB, FVector(1500.0f, 1500.0f, 300.0f));
	WindowMesh.AddBox(DeckB + FVector(0.0f, 0.0f, 70.0f), FVector(1510.0f, 1510.0f, 70.0f));

	// Cool white floodlighting, and the red beacon at the tip.
	AddPointLight(Base + FVector(0.0f, 0.0f, TotalHeight + 100.0f), FLinearColor(1.0f, 0.06f, 0.02f), 2600.0f, 7000.0f);
	AddPointLight(DeckA + FVector(0.0f, 0.0f, 600.0f), FLinearColor(0.72f, 0.86f, 1.0f), 2200.0f, 4200.0f);
	AddPointLight(DeckB + FVector(0.0f, 0.0f, 400.0f), FLinearColor(0.72f, 0.86f, 1.0f), 1400.0f, 3200.0f);

	AddLandmark(TEXT("SKYTREE"), Base, TotalHeight);
}

// ============================================================================
//  Mount Fuji
// ============================================================================

void ATDCWorldLandmarks::BuildFuji()
{
	const FVector Base(0.0f, 780000.0f, 0.0f);
	const float Height = 190000.0f;
	const float Radius = 520000.0f;

	// A concave profile: Fuji's slopes steepen toward the summit. The exponent
	// above 1 is what stops it looking like a circus tent.
	FujiMesh.AddProfile(Base, Radius, Height, 72, 26, 2.15f, 0.0f, 1.0f, 0.0f);

	// The snow cap, lifted a hair off the rock so the two surfaces never fight.
	SnowMesh.AddProfile(Base, Radius, Height, 72, 9, 2.15f, 0.80f, 1.0f, 180.0f);

	AddLandmark(TEXT("MOUNT FUJI"), Base + FVector(0.0f, 0.0f, Height * 0.5f), Height);
}

// ============================================================================
//  Rainbow Bridge
// ============================================================================

void ATDCWorldLandmarks::BuildRainbowBridge()
{
	const FVector Centre(300000.0f, 480000.0f, 0.0f);
	const FRotator Yaw(0.0f, 35.0f, 0.0f);
	const FVector Dir = Yaw.RotateVector(FVector::ForwardVector);
	const FVector Right = Yaw.RotateVector(FVector::RightVector);

	const float HalfLength = 45000.0f;
	const float DeckZ = 4000.0f;
	const float HalfWidth = 1400.0f;
	const float TowerOffset = 18000.0f;
	const float TowerHeight = 12300.0f;
	const float MidCableZ = DeckZ + 2200.0f;

	// Deck, with a slightly wider fascia.
	SteelMesh.AddBox(Centre + FVector(0.0f, 0.0f, DeckZ), FVector(HalfLength, HalfWidth, 280.0f), Yaw);
	ConcreteMesh.AddBox(Centre + FVector(0.0f, 0.0f, DeckZ - 330.0f), FVector(HalfLength, HalfWidth + 60.0f, 90.0f), Yaw);

	// Two towers.
	for (int32 Side = -1; Side <= 1; Side += 2)
	{
		const FVector At = Centre + Dir * (TowerOffset * static_cast<float>(Side)) + FVector(0.0f, 0.0f, DeckZ + TowerHeight * 0.5f);
		SteelMesh.AddBox(At, FVector(1150.0f, 1700.0f, TowerHeight * 0.5f), Yaw);
		SteelMesh.AddBox(At + FVector(0.0f, 0.0f, TowerHeight * 0.5f - 400.0f), FVector(1500.0f, 2000.0f, 300.0f), Yaw);
	}

	// Cable height as a function of distance along the deck: a parabola over the
	// main span, a shallower one over each side span.
	auto CableZ = [&](float S)
	{
		const float AbsS = FMath::Abs(S);
		if (AbsS <= TowerOffset)
		{
			const float U = (S + TowerOffset) / (TowerOffset * 2.0f);
			return FMath::Lerp(DeckZ + TowerHeight, DeckZ + TowerHeight, U)
				- (TowerHeight - 2200.0f) * 4.0f * U * (1.0f - U);
		}

		const float U = FMath::Clamp((AbsS - TowerOffset) / (HalfLength - TowerOffset), 0.0f, 1.0f);
		return FMath::Lerp(DeckZ + TowerHeight, DeckZ + 600.0f, U) - 240.0f * 4.0f * U * (1.0f - U);
	};

	for (int32 Side = -1; Side <= 1; Side += 2)
	{
		const FVector Lateral = Right * (HalfWidth - 240.0f) * static_cast<float>(Side);

		// Two main cables, sampled as short beams.
		FVector Previous = Centre + Lateral + FVector(0.0f, 0.0f, CableZ(-HalfLength));
		for (int32 i = 1; i <= 60; ++i)
		{
			const float S = FMath::Lerp(-HalfLength, HalfLength, static_cast<float>(i) / 60.0f);
			const FVector Point = Centre + Dir * S + Lateral + FVector(0.0f, 0.0f, CableZ(S));
			CableMesh.AddBeam(Previous, Point, 80.0f);
			Previous = Point;
		}

		// Hangers.
		for (float S = -42000.0f; S <= 42000.0f; S += 1500.0f)
		{
			if (FMath::Abs(FMath::Abs(S) - TowerOffset) < 1200.0f)
			{
				continue;
			}

			const FVector Top = Centre + Dir * S + Lateral + FVector(0.0f, 0.0f, CableZ(S));
			const FVector Bottom = Centre + Dir * S + Lateral + FVector(0.0f, 0.0f, DeckZ + 280.0f);
			CableMesh.AddBeam(Bottom, Top, 28.0f);
		}
	}

	// Deck lighting: a warm wash from the towers.
	AddPointLight(Centre + Dir * TowerOffset + FVector(0.0f, 0.0f, DeckZ + 14000.0f), FLinearColor(1.0f, 0.78f, 0.48f), 3200.0f, 14000.0f);
	AddPointLight(Centre - Dir * TowerOffset + FVector(0.0f, 0.0f, DeckZ + 14000.0f), FLinearColor(1.0f, 0.78f, 0.48f), 3200.0f, 14000.0f);

	AddLandmark(TEXT("RAINBOW BRIDGE"), Centre + FVector(0.0f, 0.0f, DeckZ + TowerHeight), 12600.0f);
}

// ============================================================================
//  Torii
// ============================================================================

void ATDCWorldLandmarks::BuildTorii()
{
	const int32 Count = FMath::Max(0, ToriiCount);
	if (Count == 0)
	{
		return;
	}

	const float Ring = CircuitRadius * ToriiRingRadius;

	for (int32 i = 0; i < Count; ++i)
	{
		const float Angle = 2.0f * Pi * static_cast<float>(i) / static_cast<float>(Count);
		const FVector Pos(FMath::Cos(Angle) * Ring, FMath::Sin(Angle) * Ring, 0.0f);
		const FVector Tangent(-FMath::Sin(Angle), FMath::Cos(Angle), 0.0f);
		const FRotator Facing(0.0f, FMath::RadiansToDegrees(Angle), 0.0f);

		// Pillars: 16 m gate, 13 m apart, leaning in a touch toward the top.
		ToriiMesh.AddPrism(Pos + Tangent * 650.0f, 62.0f, 52.0f, 1600.0f, 12);
		ToriiMesh.AddPrism(Pos - Tangent * 650.0f, 62.0f, 52.0f, 1600.0f, 12);

		// Kasagi (top lintel) and shimaki (the second, slightly shorter beam).
		ToriiMesh.AddBox(Pos + FVector(0.0f, 0.0f, 1600.0f), FVector(135.0f, 980.0f, 72.0f), Facing);
		ToriiMesh.AddBox(Pos + FVector(0.0f, 0.0f, 1710.0f), FVector(100.0f, 860.0f, 48.0f), Facing);

		// Nuki (the lower tie beam) and the plaque.
		ToriiMesh.AddBox(Pos + FVector(0.0f, 0.0f, 1250.0f), FVector(90.0f, 860.0f, 52.0f), Facing);
		ConcreteMesh.AddBox(Pos + FVector(0.0f, 0.0f, 1440.0f), FVector(48.0f, 170.0f, 130.0f), Facing);
	}
}

// ============================================================================
//  Skyline
// ============================================================================

void ATDCWorldLandmarks::BuildSkyline()
{
	if (SkylineBlocks <= 0)
	{
		return;
	}

	FRandomStream Random(Seed);

	const float Inner = CircuitRadius * FMath::Min(SkylineInnerRadius, SkylineOuterRadius);
	const float Outer = CircuitRadius * FMath::Max(SkylineInnerRadius, SkylineOuterRadius);
	const float BandLimit = Inner + (Outer - Inner) * 0.45f;

	for (int32 Block = 0; Block < SkylineBlocks; ++Block)
	{
		const float Angle = Random.FRandRange(0.0f, 2.0f * Pi);
		const float Radius = Random.FRandRange(Inner, Outer);
		const FVector Base(FMath::Cos(Angle) * Radius, FMath::Sin(Angle) * Radius, 0.0f);

		const float FootX = Random.FRandRange(2200.0f, 6500.0f);
		const float FootY = Random.FRandRange(2200.0f, 6500.0f);
		const float FootprintHalf = FMath::Max(FootX, FootY) * 0.5f;
		const float Yaw = Random.FRandRange(0.0f, 360.0f);
		const FRotator Facing(0.0f, Yaw, 0.0f);

		// A few landmark towers break the roofline.
		const float HeightBoost = Random.FRand() < 0.10f ? Random.FRandRange(1.4f, 1.9f) : 1.0f;
		const float TotalHeight = Random.FRandRange(3200.0f, 24000.0f) * HeightBoost;
		const int32 Tiers = Random.RandRange(1, 3);

		float Z = 0.0f;
		float ExtentX = FootX;
		float ExtentY = FootY;

		for (int32 Tier = 0; Tier < Tiers; ++Tier)
		{
			const float TierHeight = TotalHeight / static_cast<float>(Tiers) * Random.FRandRange(0.85f, 1.15f);

			ConcreteMesh.AddBox(
				Base + FVector(0.0f, 0.0f, Z + TierHeight * 0.5f),
				FVector(ExtentX * 0.5f, ExtentY * 0.5f, TierHeight * 0.5f),
				Facing);

			if (Tier == 0)
			{
				// Lit floor bands: a thin, slightly oversized box every ~8 m.
				const int32 Bands = FMath::Clamp(FMath::FloorToInt(TierHeight / 800.0f), 2, 16);
				for (int32 Band = 1; Band < Bands; ++Band)
				{
					const float BandZ = Z + TierHeight * static_cast<float>(Band) / static_cast<float>(Bands);
					WindowMesh.AddBox(
						Base + FVector(0.0f, 0.0f, BandZ),
						FVector(ExtentX * 0.5f + 12.0f, ExtentY * 0.5f + 12.0f, 52.0f),
						Facing);
				}
			}

			Z += TierHeight;
			ExtentX *= 0.78f;
			ExtentY *= 0.78f;
		}

		// Rooftop plant and, on the taller towers, an antenna.
		SteelMesh.AddBox(Base + FVector(0.0f, 0.0f, Z + 220.0f), FVector(ExtentX * 0.35f, ExtentY * 0.35f, 220.0f), Facing);
		if (TotalHeight > 16000.0f)
		{
			SteelMesh.AddPrism(Base + FVector(0.0f, 0.0f, Z + 400.0f), 45.0f, 14.0f, TotalHeight * 0.22f, 8);

			// Rooftop beacons are budgeted separately from neon: they are there to
			// give the skyline depth, not to light it.
			if (BeaconLightsPlaced < 8 && Random.FRand() < 0.5f)
			{
				AddPointLight(
					Base + FVector(0.0f, 0.0f, Z + 600.0f + TotalHeight * 0.22f),
					FLinearColor(1.0f, 0.06f, 0.02f),
					800.0f,
					3200.0f);
				++BeaconLightsPlaced;
			}
		}

		// Neon signage, facing the circuit. Only the nearer half gets a real rect
		// light; the rest rely on the emission-coloured geometry and bloom.
		if (Random.FRand() < 0.45f)
		{
			const FVector ToCentre = FVector(-Base.X, -Base.Y, 0.0f).GetSafeNormal();
			const FVector SignRight = FVector::CrossProduct(FVector::UpVector, ToCentre).GetSafeNormal();

			const float SignWidth = Random.FRandRange(900.0f, 2200.0f);
			const float SignHeight = Random.FRandRange(3500.0f, 12000.0f);
			const float SignZ = Random.FRandRange(600.0f, FMath::Max(800.0f, Z * 0.65f));
			const bool bPink = Random.FRand() < 0.5f;

			const FVector Face = Base + ToCentre * (FootprintHalf + 90.0f);
			const FVector A = Face - SignRight * (SignWidth * 0.5f) + FVector(0.0f, 0.0f, SignZ);
			const FVector B = Face + SignRight * (SignWidth * 0.5f) + FVector(0.0f, 0.0f, SignZ);
			const FVector C = Face + SignRight * (SignWidth * 0.5f) + FVector(0.0f, 0.0f, SignZ + SignHeight);
			const FVector D = Face - SignRight * (SignWidth * 0.5f) + FVector(0.0f, 0.0f, SignZ + SignHeight);

			if (bPink)
			{
				PinkMesh.AddQuad(A, B, C, D, ToCentre);
			}
			else
			{
				CyanMesh.AddQuad(A, B, C, D, ToCentre);
			}

			if (bNeonLights && Radius <= BandLimit && NeonLightsPlaced < NeonLightBudget)
			{
				AddRectLight(
					Face + ToCentre * 120.0f,
					ToCentre.Rotation(),
					bPink ? NeonPinkColor : NeonCyanColor,
					SignWidth,
					SignHeight,
					4200.0f);
				++NeonLightsPlaced;
			}
		}
	}
}
