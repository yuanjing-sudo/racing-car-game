#include "TDCChaseCameraComponent.h"

#include "Camera/CameraComponent.h"
#include "Engine/World.h"
#include "GameFramework/Actor.h"

UTDCChaseCameraComponent::UTDCChaseCameraComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
	PrimaryComponentTick.TickGroup = TG_PostPhysics;

	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(this);
	Camera->SetRelativeLocation(FVector::ZeroVector);
	Camera->bUsePawnControlRotation = false;
	Camera->SetFieldOfView(BaseFOV);
}

void UTDCChaseCameraComponent::BeginPlay()
{
	Super::BeginPlay();

	// Snap into place on the first frame so we do not lerp in from the origin.
	const AActor* Owner = GetOwner();
	if (Owner && Camera)
	{
		const FRotator YawOnly(0.0f, Owner->GetActorRotation().Yaw, 0.0f);
		const FVector Backwards = -FRotationMatrix(YawOnly).GetUnitAxis(EAxis::X);
		const FVector Desired = Owner->GetActorLocation() + Backwards * BaseDistance + FVector::UpVector * Height;
		SetWorldLocation(Desired);
		Camera->SetFieldOfView(BaseFOV);
	}
}

void UTDCChaseCameraComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

	const AActor* Owner = GetOwner();
	if (!Owner || DeltaTime <= KINDA_SMALL_NUMBER)
	{
		return;
	}

	// ---- Speed -----------------------------------------------------------
	const FVector Velocity = Owner->GetVelocity();
	const float SpeedKmh = Velocity.Size() * 0.036f; // cm/s -> km/h
	const float Reference = FMath::Max(1.0f, ReferenceTopSpeedKmh);
	Speed01 = FMath::Clamp(SpeedKmh / Reference, 0.0f, 1.0f);

	// ---- Yaw-only basis, so body roll does not tip the horizon -----------
	const FRotator YawOnly(0.0f, Owner->GetActorRotation().Yaw, 0.0f);
	const FRotationMatrix YawMatrix(YawOnly);
	const FVector Forward = YawMatrix.GetUnitAxis(EAxis::X);

	// ---- Desired position ------------------------------------------------
	const float Distance = BaseDistance + SpeedDistanceGain * Speed01;
	const FVector OwnerLocation = Owner->GetActorLocation();
	FVector DesiredLocation = OwnerLocation
		+ Forward * -Distance
		+ FVector::UpVector * Height;

	// High-speed shake: small, fast, scaled by speed.
	if (ShakeAmplitude > 0.0f && Speed01 > 0.01f)
	{
		const float Time = GetWorld() ? GetWorld()->GetTimeSeconds() : 0.0f;
		DesiredLocation += FVector(
			FMath::Sin(Time * 37.0f),
			FMath::Sin(Time * 29.0f),
			FMath::Sin(Time * 43.0f)) * ShakeAmplitude * Speed01;
	}

	const FVector SmoothedLocation = FMath::VInterpTo(GetComponentLocation(), DesiredLocation, DeltaTime, PositionInterpSpeed);
	SetWorldLocation(SmoothedLocation);

	// ---- Look at a point ahead of the car --------------------------------
	const FVector LookAhead = Velocity * LookAheadGain;
	const FVector LookTarget = OwnerLocation + LookAhead + FVector::UpVector * LookAtHeight;
	const FRotator DesiredRotation = (LookTarget - SmoothedLocation).Rotation();
	const FRotator SmoothedRotation = FMath::RInterpTo(GetComponentRotation(), DesiredRotation, DeltaTime, RotationInterpSpeed);
	SetWorldRotation(SmoothedRotation);

	// ---- FOV -------------------------------------------------------------
	if (Camera)
	{
		Camera->SetFieldOfView(FMath::Lerp(BaseFOV, MaxFOV, Speed01));
	}
}
