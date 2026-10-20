#include "TDCPhotoModeComponent.h"

#include "TDCPhotoPawn.h"
#include "TDCPlayerCar.h"
#include "Camera/PlayerCameraManager.h"
#include "Components/InputComponent.h"
#include "GameFramework/PlayerController.h"
#include "Kismet/GameplayStatics.h"

UTDCPhotoModeComponent::UTDCPhotoModeComponent()
{
	// One thing to do per frame: notice that the photographer pressed P.
	PrimaryComponentTick.bCanEverTick = true;
}

void UTDCPhotoModeComponent::BindInput(UInputComponent* PlayerInputComponent)
{
	if (PlayerInputComponent)
	{
		PlayerInputComponent->BindAction(TEXT("PhotoMode"), IE_Pressed, this, &UTDCPhotoModeComponent::TogglePhotoMode);
	}
}

void UTDCPhotoModeComponent::TogglePhotoMode()
{
	if (bActive)
	{
		ExitPhotoMode();
	}
	else
	{
		EnterPhotoMode();
	}
}

void UTDCPhotoModeComponent::EnterPhotoMode()
{
	UWorld* World = GetWorld();
	APlayerController* PC = UGameplayStatics::GetPlayerController(World, 0);
	if (bActive || !World || !PC)
	{
		return;
	}

	APawn* CurrentPawn = PC->GetPawn();
	if (!CurrentPawn)
	{
		return;
	}

	// Start from the exact frame the player is looking at, so the shot does not
	// jump when the camera becomes free.
	const FVector StartLocation = PC->PlayerCameraManager
		? PC->PlayerCameraManager->GetCameraLocation()
		: CurrentPawn->GetActorLocation();
	const FRotator StartRotation = PC->PlayerCameraManager
		? PC->PlayerCameraManager->GetCameraRotation()
		: CurrentPawn->GetActorRotation();

	UClass* PawnClass = PhotoPawnClass ? PhotoPawnClass.Get() : ATDCPhotoPawn::StaticClass();

	FActorSpawnParameters SpawnParams;
	SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	SpawnParams.Owner = CurrentPawn;

	PhotoPawn = World->SpawnActor<ATDCPhotoPawn>(PawnClass, StartLocation, StartRotation, SpawnParams);
	if (!PhotoPawn)
	{
		return;
	}

	SavedPawn = CurrentPawn;
	SavedTimeDilation = UGameplayStatics::GetGlobalTimeDilation(World);

	PC->Possess(PhotoPawn);
	PC->SetViewTargetWithBlend(PhotoPawn, 0.0f);

	// Mouse look needs the game to own the cursor.
	PC->SetInputMode(FInputModeGameOnly());
	PC->bShowMouseCursor = false;

	// Freeze the world, not the camera. ATDCPhotoPawn moves on real time.
	UGameplayStatics::SetGlobalTimeDilation(World, FMath::Max(0.00001f, FrozenTimeDilation));

	if (ATDCPlayerCar* Car = Cast<ATDCPlayerCar>(CurrentPawn))
	{
		Car->SetAudioEnabled(false);
	}

	bActive = true;
}

void UTDCPhotoModeComponent::ExitPhotoMode()
{
	if (!bActive)
	{
		return;
	}

	UWorld* World = GetWorld();
	APlayerController* PC = UGameplayStatics::GetPlayerController(World, 0);

	bActive = false;

	if (PC)
	{
		APawn* Restore = SavedPawn;
		if (Restore)
		{
			PC->Possess(Restore);
			PC->SetViewTargetWithBlend(Restore, 0.0f);

			if (ATDCPlayerCar* Car = Cast<ATDCPlayerCar>(Restore))
			{
				Car->SetAudioEnabled(true);
			}
		}
	}

	if (PhotoPawn)
	{
		PhotoPawn->Destroy();
		PhotoPawn = nullptr;
	}

	if (World)
	{
		UGameplayStatics::SetGlobalTimeDilation(World, SavedTimeDilation > 0.0f ? SavedTimeDilation : 1.0f);
	}

	SavedPawn = nullptr;
}

void UTDCPhotoModeComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

	if (bActive && PhotoPawn && PhotoPawn->IsExitRequested())
	{
		ExitPhotoMode();
	}
}

void UTDCPhotoModeComponent::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	// Never leave the world frozen or the camera possessed by a destroyed pawn.
	if (bActive)
	{
		ExitPhotoMode();
	}

	Super::EndPlay(EndPlayReason);
}
