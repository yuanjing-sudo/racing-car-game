#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "TDCPlayerCar.generated.h"
class UStaticMeshComponent;class USpringArmComponent;class UCameraComponent;
UCLASS() class TOKYODREAMCIRCUIT_API ATDCPlayerCar:public APawn{
 GENERATED_BODY()
public:
 ATDCPlayerCar();virtual void Tick(float Dt) override;virtual void SetupPlayerInputComponent(UInputComponent* I) override;
 UPROPERTY(VisibleAnywhere) TObjectPtr<UStaticMeshComponent> Body;
 UPROPERTY(VisibleAnywhere) TObjectPtr<USpringArmComponent> Arm;
 UPROPERTY(VisibleAnywhere) TObjectPtr<UCameraComponent> Camera;
 UPROPERTY(EditAnywhere,Category="Handling") float MaxSpeedKmh=342;
 UPROPERTY(EditAnywhere,Category="Handling") float WetGrip=.72f;
private:float Throttle=0,Steer=0;bool Brake=false,Handbrake=false;
 void SetThrottle(float V);void SetSteer(float V);void SetBrake(float V);void HBDown();void HBUp();
};