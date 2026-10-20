#include "TDCWeatherSystem.h"

#include "Camera/PlayerCameraManager.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/SceneComponent.h"
#include "Engine/StaticMesh.h"
#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "TDCPlayerCar.h"
#include "TDCProceduralRoad.h"

ATDCWeatherSystem::ATDCWeatherSystem()
{
	PrimaryActorTick.bCanEverTick = true;

	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	RootComponent = Root;

	Rain = CreateDefaultSubobject<UInstancedStaticMeshComponent>(TEXT("Rain"));
	Rain->SetupAttachment(Root);
	Rain->SetMobility(EComponentMobility::Movable);
	Rain->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Rain->SetCastShadow(false);
	Rain->SetCanEverAffectNavigation(false);

	Spray = CreateDefaultSubobject<UInstancedStaticMeshComponent>(TEXT("Spray"));
	Spray->SetupAttachment(Root);
	Spray->SetMobility(EComponentMobility::Movable);
	Spray->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Spray->SetCastShadow(false);
	Spray->SetCanEverAffectNavigation(false);

	Random.Initialize(1337);
}

void ATDCWeatherSystem::BeginPlay()
{
	Super::BeginPlay();

	UStaticMesh* Cube = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));
	UMaterialInterface* BaseMaterial = LoadObject<UMaterialInterface>(nullptr, TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));

	if (Cube && BaseMaterial)
	{
		RainMaterial = UMaterialInstanceDynamic::Create(BaseMaterial, this);
		if (RainMaterial)
		{
			// Cold, slightly brighter than the sky: rain reads by contrast.
			RainMaterial->SetVectorParameterValue(TEXT("Color"), FLinearColor(0.68f, 0.78f, 0.88f));
			Rain->SetMaterial(0, RainMaterial);
		}

		SprayMaterial = UMaterialInstanceDynamic::Create(BaseMaterial, this);
		if (SprayMaterial)
		{
			// Vapour, not smoke: a pale warm grey that takes the golden light.
			SprayMaterial->SetVectorParameterValue(TEXT("Color"), FLinearColor(0.86f, 0.84f, 0.80f));
			Spray->SetMaterial(0, SprayMaterial);
		}

		Rain->SetStaticMesh(Cube);
		Spray->SetStaticMesh(Cube);
	}

	InitRain();
	InitSpray();
	RefreshWetness();
	bInitialised = true;
}

void ATDCWeatherSystem::InitRain()
{
	if (!Rain)
	{
		return;
	}

	MaxDrops = FMath::Max(0, MaxDrops);
	DropPositions.SetNum(MaxDrops);
	DropTransforms.SetNum(MaxDrops);
	Rain->ClearInstances();

	for (int32 i = 0; i < MaxDrops; ++i)
	{
		const FVector Start(
			Random.FRandRange(-RainRadius, RainRadius),
			Random.FRandRange(-RainRadius, RainRadius),
			Random.FRandRange(-800.0f, RainHeight));

		DropPositions[i] = Start;
		Rain->AddInstance(FTransform(FQuat::Identity, Start, FVector(0.001f)), true);
	}

	ActiveDrops = FMath::Clamp(FMath::RoundToInt(static_cast<float>(MaxDrops) * RainIntensity), 0, MaxDrops);
}

void ATDCWeatherSystem::InitSpray()
{
	if (!Spray)
	{
		return;
	}

	MaxSprayPuffs = FMath::Max(0, MaxSprayPuffs);
	SprayPositions.SetNum(MaxSprayPuffs);
	SprayVelocities.SetNum(MaxSprayPuffs);
	SprayLives.SetNum(MaxSprayPuffs);
	SprayTransforms.SetNum(MaxSprayPuffs);
	SprayLives.Init(0.0f, MaxSprayPuffs);
	Spray->ClearInstances();

	for (int32 i = 0; i < MaxSprayPuffs; ++i)
	{
		Spray->AddInstance(FTransform(FQuat::Identity, FVector(0.0f, 0.0f, -100000.0f), FVector(0.001f)), true);
	}
}

void ATDCWeatherSystem::SetRainIntensity(float NewIntensity)
{
	RainIntensity = FMath::Clamp(NewIntensity, 0.0f, 1.0f);
	ActiveDrops = FMath::Clamp(FMath::RoundToInt(static_cast<float>(MaxDrops) * RainIntensity), 0, MaxDrops);
	RefreshWetness();
}

void ATDCWeatherSystem::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	if (!bInitialised || DeltaSeconds <= 0.0f)
	{
		return;
	}

	TickRain(DeltaSeconds);
	TickSpray(DeltaSeconds);

	WetnessRefreshTimer += DeltaSeconds;
	if (WetnessRefreshTimer >= 1.0f)
	{
		WetnessRefreshTimer = 0.0f;
		RefreshWetness();
	}
}

void ATDCWeatherSystem::TickRain(float DeltaSeconds)
{
	if (!Rain || DropPositions.Num() == 0)
	{
		return;
	}

	const APlayerCameraManager* Camera = UGameplayStatics::GetPlayerCameraManager(this, 0);
	const FVector Centre = Camera ? Camera->GetCameraLocation() : GetActorLocation();

	const FVector Velocity(WindDrift.X, WindDrift.Y, -FMath::Max(100.0f, FallSpeed));
	const FVector Step = Velocity * DeltaSeconds;
	const FVector Direction = Velocity.GetSafeNormal();
	const FQuat Rotation = FQuat::FindBetweenNormals(FVector::UpVector, Direction);

	const int32 Count = DropPositions.Num();
	const float TwoRadius = RainRadius * 2.0f;

	for (int32 i = 0; i < Count; ++i)
	{
		FVector& Position = DropPositions[i];
		Position += Step;

		FVector Local = Position - Centre;

		// Wrap horizontally: rain is everywhere, but only this box is drawn.
		if (Local.X > RainRadius) { Local.X -= TwoRadius; }
		if (Local.X < -RainRadius) { Local.X += TwoRadius; }
		if (Local.Y > RainRadius) { Local.Y -= TwoRadius; }
		if (Local.Y < -RainRadius) { Local.Y += TwoRadius; }

		// Recycle a drop that has fallen past the camera to the top of the box.
		if (Local.Z < -800.0f || Local.Z > RainHeight + 200.0f)
		{
			Local.X = Random.FRandRange(-RainRadius, RainRadius);
			Local.Y = Random.FRandRange(-RainRadius, RainRadius);
			Local.Z = RainHeight;
		}

		Position = Centre + Local;

		const bool bActive = i < ActiveDrops;
		const float LengthVariation = 0.65f + 0.7f * FMath::Frac(static_cast<float>(i) * 0.618034f);
		const FVector Scale(0.013f, 0.013f, (StreakLength + RainIntensity * 1.1f) * LengthVariation);

		DropTransforms[i] = FTransform(bActive ? Rotation : FQuat::Identity, Position, bActive ? Scale : FVector(0.001f));
	}

	Rain->BatchUpdateInstancesTransforms(0, DropTransforms, true, true, true);
}

void ATDCWeatherSystem::SpawnSpray(const FVector& Location, const FVector& Velocity, float Life)
{
	if (MaxSprayPuffs <= 0)
	{
		return;
	}

	// Round-robin allocation. A live puff is reused only after its life expires,
	// which is fine at 340 slots.
	for (int32 Attempt = 0; Attempt < MaxSprayPuffs; ++Attempt)
	{
		const int32 Index = (SprayCursor + Attempt) % MaxSprayPuffs;
		if (SprayLives[Index] <= 0.0f)
		{
			SprayPositions[Index] = Location;
			SprayVelocities[Index] = Velocity;
			SprayLives[Index] = Life;
			SprayCursor = (Index + 1) % MaxSprayPuffs;
			return;
		}
	}
}

void ATDCWeatherSystem::TickSpray(float DeltaSeconds)
{
	if (!Spray || SprayLives.Num() == 0)
	{
		return;
	}

	if (bWheelSpray)
	{
		if (!Car.IsValid())
		{
			for (TActorIterator<ATDCPlayerCar> It(GetWorld()); It; ++It)
			{
				Car = *It;
				break;
			}
		}

		if (Car.IsValid())
		{
			const float SpeedKmh = Car->GetAbsoluteSpeedKmh();
			const float Wet = FMath::Clamp(Car->Wetness, 0.0f, 1.0f);

			if (SpeedKmh > 50.0f && Wet > 0.2f)
			{
				const float DriftScale = 1.0f + FMath::Clamp(Car->GetDriftAngleDeg(), 0.0f, 45.0f) * 0.06f;
				const float Rate = (40.0f + SpeedKmh * 1.1f) * Wet * DriftScale;

				SpawnAccumulator += Rate * DeltaSeconds;
				const int32 ToSpawn = FMath::Min(FMath::FloorToInt(SpawnAccumulator), 14);
				SpawnAccumulator -= static_cast<float>(ToSpawn);

				const FTransform CarTransform = Car->GetActorTransform();
				const FVector Forward = Car->GetActorForwardVector();
				const FVector Right = Car->GetActorRightVector();

				for (int32 i = 0; i < ToSpawn; ++i)
				{
					const float Side = ((SprayCursor + i) % 2 == 0) ? 1.0f : -1.0f;
					const FVector Local(
						-Car->WheelBase * 0.5f,
						Side * Car->TrackWidth * 0.5f,
						-Car->WheelRadius * 0.6f);

					const FVector SpawnPoint = CarTransform.TransformPosition(Local)
						+ FVector(Random.FRandRange(-12.0f, 12.0f), Random.FRandRange(-12.0f, 12.0f), 0.0f);

					const FVector SprayVelocity =
						-Forward * Random.FRandRange(160.0f, 520.0f)
						+ Right * Side * Random.FRandRange(20.0f, 120.0f)
						+ FVector(0.0f, 0.0f, Random.FRandRange(140.0f, 360.0f));

					SpawnSpray(SpawnPoint, SprayVelocity, Random.FRandRange(0.35f, 0.65f));
				}
			}
		}
	}

	for (int32 i = 0; i < SprayLives.Num(); ++i)
	{
		if (SprayLives[i] <= 0.0f)
		{
			SprayTransforms[i] = FTransform(FQuat::Identity, FVector(0.0f, 0.0f, -100000.0f), FVector(0.001f));
			continue;
		}

		SprayLives[i] -= DeltaSeconds;
		SprayVelocities[i].Z -= 900.0f * DeltaSeconds;
		SprayPositions[i] += SprayVelocities[i] * DeltaSeconds;

		// Puffs grow as they dissipate. No opacity to fade: the size change and
		// the short life do the work.
		const float Age = FMath::Clamp(1.0f - SprayLives[i] / 0.65f, 0.0f, 1.0f);
		const float Size = FMath::Lerp(0.18f, 0.85f, Age);

		SprayTransforms[i] = FTransform(FQuat::Identity, SprayPositions[i], FVector(Size, Size, Size * 0.6f));
	}

	Spray->BatchUpdateInstancesTransforms(0, SprayTransforms, true, true, true);
}

void ATDCWeatherSystem::RefreshWetness()
{
	const float Wetness = FMath::Clamp(RainIntensity, 0.0f, 1.0f) * FMath::Clamp(FullRainWetness, 0.0f, 1.0f);

	if (bDriveCarWetness)
	{
		for (TActorIterator<ATDCPlayerCar> It(GetWorld()); It; ++It)
		{
			It->Wetness = Wetness;
		}
	}

	if (!bWetRoad)
	{
		return;
	}

	if (!Road.IsValid())
	{
		for (TActorIterator<ATDCProceduralRoad> It(GetWorld()); It; ++It)
		{
			Road = *It;
			break;
		}
	}

	if (!Road.IsValid())
	{
		return;
	}

	if (!RoadMaterial)
	{
		RoadMaterial = Road->CreateDynamicMaterialInstance(0, Road->GetMaterial(0));
	}

	if (RoadMaterial)
	{
		// Documented parameter names for the project's wet asphalt material. A
		// material that does not declare them simply ignores the write.
		RoadMaterial->SetScalarParameterValue(TEXT("Wetness"), Wetness);
		RoadMaterial->SetScalarParameterValue(TEXT("RainIntensity"), RainIntensity);
		RoadMaterial->SetScalarParameterValue(TEXT("PuddleMask"), FMath::Clamp(RainIntensity * 1.15f, 0.0f, 1.0f));
	}
}
