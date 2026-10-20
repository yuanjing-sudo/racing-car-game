#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "TDCPhotoModeComponent.generated.h"

class ATDCPhotoPawn;
class APawn;
class UInputComponent;

/**
 * UTDCPhotoModeComponent
 *
 * Owns the transition in and out of Photo Mode. Attach it to the player car; the
 * car's input component forwards the PhotoMode action, so this works with the
 * same input set-up whether the car was placed by hand or spawned by the game
 * mode.
 *
 * Photo Mode does three things:
 *   1. spawns ATDCPhotoPawn at the current camera, possesses it and leaves the
 *      car where it is;
 *   2. slows world time to a crawl (FrozenTimeDilation), so the rain hangs and
 *      the car is a still subject while the photographer moves at real speed;
 *   3. silences the car's synthesised audio, because a frozen engine note is
 *      not a photograph.
 *
 * The HUD is deliberately left running: ATDCHUD detects the photo pawn and swaps
 * to the framing overlay (thirds, lens readout, controls) instead of hiding.
 */
UCLASS(ClassGroup = (Camera), meta = (BlueprintSpawnableComponent))
class TOKYODREAMCIRCUIT_API UTDCPhotoModeComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UTDCPhotoModeComponent();

	/** Called from the owning pawn's SetupPlayerInputComponent. */
	void BindInput(UInputComponent* PlayerInputComponent);

	UFUNCTION(BlueprintCallable, Category = "Photo Mode")
	void TogglePhotoMode();

	UFUNCTION(BlueprintCallable, Category = "Photo Mode")
	void EnterPhotoMode();

	UFUNCTION(BlueprintCallable, Category = "Photo Mode")
	void ExitPhotoMode();

	UFUNCTION(BlueprintPure, Category = "Photo Mode")
	bool IsActive() const { return bActive; }

	/** Photo pawn class. Defaults to ATDCPhotoPawn when left empty. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Photo Mode")
	TSubclassOf<ATDCPhotoPawn> PhotoPawnClass;

	/** World time scale while a shot is being framed. Small is good; zero can
	 *  starve the physics thread. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Photo Mode", meta = (ClampMin = "0.00001", UIMax = "0.1"))
	float FrozenTimeDilation = 0.0001f;

protected:
	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

private:
	UPROPERTY()
	TObjectPtr<ATDCPhotoPawn> PhotoPawn;

	UPROPERTY()
	TObjectPtr<APawn> SavedPawn;

	bool bActive = false;
	float SavedTimeDilation = 1.0f;
};
