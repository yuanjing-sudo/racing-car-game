#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "TDCPhotoPawn.generated.h"

class UCameraComponent;
class UInputComponent;

/**
 * ATDCPhotoPawn
 *
 * Free-flying camera for Photo Mode. It is spawned by UTDCPhotoModeComponent,
 * possessed for the duration of the shot, and destroyed on exit.
 *
 * Motion uses FApp::GetDeltaTime() rather than the world delta, because Photo
 * Mode freezes world time to a crawl. World time slows the cars and the rain to
 * a still frame; the photographer still moves at normal speed.
 *
 * The lens is a real 36 mm full-frame set-up: field of view, f-stop and focus
 * distance drive the camera's post-process overrides, so depth of field in a
 * captured frame comes from the engine's physical camera, not a filter.
 */
UCLASS()
class TOKYODREAMCIRCUIT_API ATDCPhotoPawn : public APawn
{
	GENERATED_BODY()

public:
	ATDCPhotoPawn();

	virtual void Tick(float DeltaSeconds) override;
	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

	/** The photograph. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Photo")
	TObjectPtr<UCameraComponent> Camera;

	/** Free-fly speed at normal thrust, in centimetres per second. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Photo", meta = (ClampMin = "50.0"))
	float MoveSpeed = 900.0f;

	/** Multiplier while PhotoBoost is held. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Photo", meta = (ClampMin = "1.0"))
	float BoostMultiplier = 6.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Photo", meta = (ClampMin = "0.1"))
	float MouseSensitivity = 1.6f;

	/** Horizontal field of view, in degrees. 18 = long lens, 90 = wide. */
	UFUNCTION(BlueprintCallable, Category = "Photo")
	void SetFOV(float NewFOV);

	UFUNCTION(BlueprintPure, Category = "Photo")
	float GetFOV() const { return FOV; }

	/** f-stop. 1.4 = paper-thin focus, 22 = everything sharp. */
	UFUNCTION(BlueprintCallable, Category = "Photo")
	void SetAperture(float NewAperture);

	UFUNCTION(BlueprintPure, Category = "Photo")
	float GetAperture() const { return Aperture; }

	/** Focus distance from the camera, in centimetres. */
	UFUNCTION(BlueprintCallable, Category = "Photo")
	void SetFocusDistance(float NewDistance);

	UFUNCTION(BlueprintPure, Category = "Photo")
	float GetFocusDistance() const { return FocusDistance; }

	/** True while the shutter is being held open (PhotoCapture). */
	UFUNCTION(BlueprintPure, Category = "Photo")
	bool IsCapturing() const { return bCaptureHeld; }

	/** P sets this, and UTDCPhotoModeComponent ticks it and hands control back
	 *  to the car. Polling beats destroying this pawn from inside its own input
	 *  callback, which is where P is handled. */
	UFUNCTION(BlueprintPure, Category = "Photo")
	bool IsExitRequested() const { return bExitRequested; }

private:
	void MoveForward(float Value);
	void MoveRight(float Value);
	void MoveUp(float Value);
	void Turn(float Value);
	void LookUp(float Value);
	void Zoom(float Value);
	void ApertureUp();
	void ApertureDown();
	void FocusNear();
	void FocusFar();
	void BoostPressed();
	void BoostReleased();
	void CapturePressed();
	void CaptureReleased();
	void ExitRequested();
	void ApplyLens();

	FVector MoveInput = FVector::ZeroVector;
	FVector2D LookInput = FVector2D::ZeroVector;

	float FOV = 45.0f;
	float Aperture = 2.8f;
	float FocusDistance = 3000.0f;
	bool bBoost = false;
	bool bCaptureHeld = false;
	bool bExitRequested = false;
};
