#include "TDCSkidMarkSystem.h"

#include "Components/InstancedStaticMeshComponent.h"
#include "Components/SceneComponent.h"
#include "Engine/StaticMesh.h"
#include "EngineUtils.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "TDCPlayerCar.h"

ATDCSkidMarkSystem::ATDCSkidMarkSystem()
{
	PrimaryActorTick.bCanEverTick = true;

	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	RootComponent = Root;

	Marks = CreateDefaultSubobject<UInstancedStaticMeshComponent>(TEXT("Marks"));
	Marks->SetupAttachment(Root);
	Marks->SetMobility(EComponentMobility::Movable);
	Marks->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Marks->SetCastShadow(false);
	Marks->SetCanEverAffectNavigation(false);
	Marks->SetGenerateOverlapEvents(false);
}

void ATDCSkidMarkSystem::BeginPlay()
{
	Super::BeginPlay();
	InitPool();
}

void ATDCSkidMarkSystem::InitPool()
{
	if (!Marks)
	{
		return;
	}

	MaxSegments = FMath::Max(16, MaxSegments);

	UStaticMesh* Cube = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));
	UMaterialInterface* BaseMaterial = LoadObject<UMaterialInterface>(
		nullptr, TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));

	if (Cube)
	{
		Marks->SetStaticMesh(Cube);
	}

	if (BaseMaterial)
	{
		MarkMaterial = UMaterialInstanceDynamic::Create(BaseMaterial, this);
		if (MarkMaterial)
		{
			MarkMaterial->SetVectorParameterValue(TEXT("Color"), RubberColor);
			Marks->SetMaterial(0, MarkMaterial);
		}
	}

	Marks->ClearInstances();
	RemainingLife.Init(0.0f, MaxSegments);

	const FTransform Hidden(FQuat::Identity, FVector(0.0f, 0.0f, -100000.0f), FVector(0.001f));
	for (int32 i = 0; i < MaxSegments; ++i)
	{
		Marks->AddInstance(Hidden, true);
	}

	NextFree = 0;
	Cursor = 0;
	SegmentCount = 0;
	bInitialised = true;

	for (int32 i = 0; i < 4; ++i)
	{
		bHasLast[i] = false;
	}
}

void ATDCSkidMarkSystem::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	if (!bInitialised || DeltaSeconds <= 0.0f)
	{
		return;
	}

	ATDCPlayerCar* Target = FindCar();
	if (!Target)
	{
		for (int32 i = 0; i < 4; ++i)
		{
			bHasLast[i] = false;
		}
		return;
	}

	const bool bSliding =
		FMath::Abs(Target->GetRearSlipAngleDeg()) > MinSlipDegrees
		|| Target->GetTyreSlip01() > MinSlip01;
	const bool bMarking = bSliding && Target->GetAbsoluteSpeedKmh() > MinSpeedKmh;

	const FVector Lift(0.0f, 0.0f, MarkLift);

	for (int32 Wheel = 2; Wheel < 4; ++Wheel)
	{
		ApplyWheel(Wheel, Target->GetWheelWorldLocation(Wheel) + Lift, bMarking);
	}

	if (bFrontWheelsToo)
	{
		for (int32 Wheel = 0; Wheel < 2; ++Wheel)
		{
			ApplyWheel(Wheel, Target->GetWheelWorldLocation(Wheel) + Lift, bMarking);
		}
	}

	if (MarkLifeSeconds > 0.0f)
	{
		for (int32 i = 0; i < NextFree; ++i)
		{
			if (RemainingLife[i] <= 0.0f)
			{
				continue;
			}

			RemainingLife[i] -= DeltaSeconds;
			if (RemainingLife[i] <= 0.0f)
			{
				RemainingLife[i] = 0.0f;
				HideInstance(i);
			}
		}
	}
}

void ATDCSkidMarkSystem::ApplyWheel(int32 WheelIndex, const FVector& Contact, bool bMarking)
{
	if (!bMarking)
	{
		bHasLast[WheelIndex] = false;
		return;
	}

	if (!bHasLast[WheelIndex])
	{
		LastPoint[WheelIndex] = Contact;
		bHasLast[WheelIndex] = true;
		return;
	}

	const FVector& Previous = LastPoint[WheelIndex];
	if (FVector::Dist2D(Previous, Contact) < SegmentSpacing)
	{
		return;
	}

	WriteSegment(Previous, Contact);
	LastPoint[WheelIndex] = Contact;
}

void ATDCSkidMarkSystem::WriteSegment(const FVector& A, const FVector& B)
{
	if (!Marks)
	{
		return;
	}

	const FVector Delta = B - A;
	const float Length = Delta.Size2D();
	if (Length < 1.0f)
	{
		return;
	}

	const float Yaw = FMath::RadiansToDegrees(FMath::Atan2(Delta.Y, Delta.X));
	const FVector Mid = (A + B) * 0.5f;

	// The cube is 100 cm on each axis, so the scale is the size in metres.
	// A centimetre of overlap hides the seam between segments.
	const FTransform Segment(
		FRotator(0.0f, Yaw, 0.0f),
		Mid,
		FVector((Length + 1.0f) / 100.0f, MarkWidth / 100.0f, MarkThickness / 100.0f));

	int32 Index;
	if (NextFree < MaxSegments)
	{
		Index = NextFree;
		++NextFree;
		SegmentCount = NextFree;
	}
	else
	{
		Index = Cursor;
		Cursor = (Cursor + 1) % MaxSegments;
	}

	RemainingLife[Index] = MarkLifeSeconds > 0.0f ? MarkLifeSeconds : -1.0f;
	Marks->UpdateInstanceTransform(Index, Segment, true, true, true);
}

void ATDCSkidMarkSystem::HideInstance(int32 Index)
{
	if (!Marks || Index < 0 || Index >= MaxSegments)
	{
		return;
	}

	const FTransform Hidden(FQuat::Identity, FVector(0.0f, 0.0f, -100000.0f), FVector(0.001f));
	Marks->UpdateInstanceTransform(Index, Hidden, true, true, false);
}

void ATDCSkidMarkSystem::HideAll()
{
	for (int32 i = 0; i < NextFree; ++i)
	{
		HideInstance(i);
	}

	for (int32 i = 0; i < 4; ++i)
	{
		bHasLast[i] = false;
	}

	NextFree = 0;
	Cursor = 0;
	SegmentCount = 0;

	if (RemainingLife.Num() > 0)
	{
		RemainingLife.Init(0.0f, RemainingLife.Num());
	}
}

void ATDCSkidMarkSystem::ClearMarks()
{
	HideAll();
}

ATDCPlayerCar* ATDCSkidMarkSystem::FindCar()
{
	if (Car.IsValid())
	{
		return Car.Get();
	}

	for (TActorIterator<ATDCPlayerCar> It(GetWorld()); It; ++It)
	{
		Car = *It;
		return *It;
	}

	return nullptr;
}
