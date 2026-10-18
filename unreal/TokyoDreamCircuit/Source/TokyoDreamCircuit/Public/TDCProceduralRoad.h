#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "TDCProceduralRoad.generated.h"
class UProceduralMeshComponent;
UCLASS() class TOKYODREAMCIRCUIT_API ATDCProceduralRoad:public AActor{
 GENERATED_BODY()
public:
 ATDCProceduralRoad();
 UPROPERTY(VisibleAnywhere) TObjectPtr<UProceduralMeshComponent> RoadMesh;
 UPROPERTY(EditAnywhere,Category="Road") float RoadLength=18000.f;
 UPROPERTY(EditAnywhere,Category="Road") float RoadWidth=1200.f;
 UPROPERTY(EditAnywhere,Category="Road") float SampleSpacing=100.f;
 UPROPERTY(EditAnywhere,Category="Road") float BankDegrees=12.f;
 UPROPERTY(EditAnywhere,Category="Road") float ElevationAmplitude=900.f;
 UPROPERTY(EditAnywhere,Category="Road") float CurveAmplitude=1700.f;
 UPROPERTY(EditAnywhere,Category="Road") TObjectPtr<UMaterialInterface> WetAsphaltMaterial;
 UFUNCTION(CallInEditor) void RebuildRoad();
protected: virtual void OnConstruction(const FTransform& T) override;
private: void BuildRoadMesh();
};