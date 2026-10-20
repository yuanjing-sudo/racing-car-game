#include "TDCPhotoPawn.h"

#include "Camera/CameraComponent.h"
#include "Components/InputComponent.h"
#include "Engine/Engine.h"
#include "Misc/App.h"

ATDCPhotoPawn::ATDCPhotoPawn()
{
	PrimaryActorTick.bCanEverTick = true;

	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("PhotoCamera"));
	RootComponent = Camera;
	Camera->bUsePawnControlRotation = false;
	Camera->bConstrainAspectRatio = true;
	Camera->AspectRatio = 2.39f;
	Camera->SetFieldOfView(FOV);

	// Physical camera: a 36 mm frame with a real f-stop. The engine's depth of
	// field then knows what "2.8 at 12 metres" means.
	FPostProcessSettings& PP = Camera->PostProcessSettings;
	PP.bOverride_DepthOfFieldFstop = true;
	PP.bOverride_DepthOfFieldFocalDistance = true;
	PP.bOverride_DepthOfFieldSensorWidth = true;
	PP.DepthOfFieldSensorWidth = 36.0f;
	ApplyLens();

	// A still frame should not jitter: no camera lag, no control rotation.
	Camera->PostProcessSettings.bOverride_MotionBlurAmount = true;
	Camera->PostProcessSettings.MotionBlurAmount = 0.0f;

	AutoPossessPlayer = EAutoReceiveInput::Disabled;
}

void ATDCPhotoPawn::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);

	if (!PlayerInputComponent)
	{
		return;
	}

	PlayerInputComponent->BindAxis(TEXT("PhotoForward"), this, &ATDCPhotoPawn::MoveForward);
	PlayerInputComponent->BindAxis(TEXT("PhotoRight"), this, &ATDCPhotoPawn::MoveRight);
	PlayerInputComponent->BindAxis(TEXT("PhotoUp"), this, &ATDCPhotoPawn::MoveUp);
	PlayerInputComponent->BindAxis(TEXT("PhotoTurn"), this, &ATDCPhotoPawn::Turn);
	PlayerInputComponent->BindAxis(TEXT("PhotoLookUp"), this, &ATDCPhotoPawn::LookUp);
	PlayerInputComponent->BindAxis(TEXT("PhotoFOV"), this, &ATDCPhotoPawn::Zoom);

	PlayerInputComponent->BindAction(TEXT("PhotoApertureUp"), IE_Pressed, this, &ATDCPhotoPawn::ApertureUp);
	PlayerInputComponent->BindAction(TEXT("PhotoApertureDown"), IE_Pressed, this, &ATDCPhotoPawn::ApertureDown);
	PlayerInputComponent->BindAction(TEXT("PhotoFocusNear"), IE_Pressed, this, &ATDCPhotoPawn::FocusNear);
	PlayerInputComponent->BindAction(TEXT("PhotoFocusFar"), IE_Pressed, this, &ATDCPhotoPawn::FocusFar);
	PlayerInputComponent->BindAction(TEXT("PhotoBoost"), IE_Pressed, this, &ATDCPhotoPawn::BoostPressed);
	PlayerInputComponent->BindAction(TEXT("PhotoBoost"), IE_Released, this, &ATDCPhotoPawn::BoostReleased);
	PlayerInputComponent->BindAction(TEXT("PhotoCapture"), IE_Pressed, this, &ATDCPhotoPawn::CapturePressed);
	PlayerInputComponent->BindAction(TEXT("PhotoCapture"), IE_Released, this, &ATDCPhotoPawn::CaptureReleased);
	PlayerInputComponent->BindAction(TEXT("PhotoMode"), IE_Pressed, this, &ATDCPhotoPawn::ExitRequested);
}

void ATDCPhotoPawn::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	// Real seconds, not world seconds: Photo Mode runs the world at 0.0001x.
	const float RealDelta = FMath::Clamp(static_cast<float>(FApp::GetDeltaTime()), 0.0f, 0.05f);

	if (!LookInput.IsNearlyZero())
	{
		FRotator Rotation = GetActorRotation();
		Rotation.Yaw += LookInput.X * MouseSensitivity;
		Rotation.Pitch = FMath::Clamp(Rotation.Pitch - LookInput.Y * MouseSensitivity, -85.0f, 85.0f);
		Rotation.Roll = 0.0f;
		SetActorRotation(Rotation);
		LookInput = FVector2D::ZeroVector;
	}

	if (!MoveInput.IsNearlyZero())
	{
		// Yaw-only basis so looking up does not make W climb.
		const FRotator YawOnly(0.0f, GetActorRotation().Yaw, 0.0f);
		const FVector Local(MoveInput.X, MoveInput.Y, 0.0f);
		const FVector Direction = YawOnly.RotateVector(Local) + FVector(0.0f, 0.0f, MoveInput.Z);
		const float Speed = MoveSpeed * (bBoost ? BoostMultiplier : 1.0f);
		AddActorWorldOffset(Direction.GetClampedToMaxSize(1.0f) * Speed * RealDelta, false);
	}
}

void ATDCPhotoPawn::SetFOV(float NewFOV)
{
	FOV = FMath::Clamp(NewFOV, 12.0f, 110.0f);
	ApplyLens();
}

void ATDCPhotoPawn::SetAperture(float NewAperture)
{
	Aperture = FMath::Clamp(NewAperture, 1.4f, 22.0f);
	ApplyLens();
}

void ATDCPhotoPawn::SetFocusDistance(float NewDistance)
{
	FocusDistance = FMath::Clamp(NewDistance, 50.0f, 100000.0f);
	ApplyLens();
}

void ATDCPhotoPawn::ApplyLens()
{
	if (!Camera)
	{
		return;
	}

	Camera->SetFieldOfView(FOV);

	FPostProcessSettings& PP = Camera->PostProcessSettings;
	PP.bOverride_DepthOfFieldFstop = true;
	PP.DepthOfFieldFstop = Aperture;
	PP.bOverride_DepthOfFieldFocalDistance = true;
	PP.DepthOfFieldFocalDistance = FocusDistance;
	PP.bOverride_DepthOfFieldSensorWidth = true;
	PP.DepthOfFieldSensorWidth = 36.0f;
}

void ATDCPhotoPawn::MoveForward(float Value)
{
	MoveInput.X = FMath::Clamp(Value, -1.0f, 1.0f);
}

void ATDCPhotoPawn::MoveRight(float Value)
{
	MoveInput.Y = FMath::Clamp(Value, -1.0f, 1.0f);
}

void ATDCPhotoPawn::MoveUp(float Value)
{
	MoveInput.Z = FMath::Clamp(Value, -1.0f, 1.0f);
}

void ATDCPhotoPawn::Turn(float Value)
{
	LookInput.X += Value;
}

void ATDCPhotoPawn::LookUp(float Value)
{
	LookInput.Y += Value;
}

void ATDCPhotoPawn::Zoom(float Value)
{
	if (FMath::IsNearlyZero(Value))
	{
		return;
	}

	// Wheel forward = longer lens. Multiplicative so the feel is even across
	// the whole range.
	SetFOV(FOV * FMath::Pow(0.94f, Value));
}

void ATDCPhotoPawn::ApertureUp()
{
	// One third of a stop.
	SetAperture(Aperture * 1.122f);
}

void ATDCPhotoPawn::ApertureDown()
{
	SetAperture(Aperture / 1.122f);
}

void ATDCPhotoPawn::FocusNear()
{
	SetFocusDistance(FocusDistance * 0.82f);
}

void ATDCPhotoPawn::FocusFar()
{
	SetFocusDistance(FocusDistance / 0.82f);
}

void ATDCPhotoPawn::BoostPressed()
{
	bBoost = true;
}

void ATDCPhotoPawn::BoostReleased()
{
	bBoost = false;
}

void ATDCPhotoPawn::CapturePressed()
{
	bCaptureHeld = true;

	// HighResShot is multiplicative: "2" renders at 200% and downsamples, which
	// is a cleaner still than a viewport grab. Shots land in Saved/Screenshots.
	if (UWorld* World = GetWorld())
	{
		GEngine->Exec(World, TEXT("HighResShot 2"));
		GEngine->AddOnScreenDebugMessage(-1, 2.5f, FColor::White,
			TEXT("Photo saved to Saved/Screenshots"));
	}
}

void ATDCPhotoPawn::CaptureReleased()
{
	bCaptureHeld = false;
}

void ATDCPhotoPawn::ExitRequested()
{
	bExitRequested = true;
}
