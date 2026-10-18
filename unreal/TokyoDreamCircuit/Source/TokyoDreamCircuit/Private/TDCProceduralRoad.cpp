#include "TDCProceduralRoad.h"
#include "ProceduralMeshComponent.h"
ATDCProceduralRoad::ATDCProceduralRoad(){PrimaryActorTick.bCanEverTick=false;RoadMesh=CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("RoadSurface"));RootComponent=RoadMesh;RoadMesh->bUseAsyncCooking=true;RoadMesh->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);}
void ATDCProceduralRoad::OnConstruction(const FTransform& T){BuildRoadMesh();}
void ATDCProceduralRoad::RebuildRoad(){BuildRoadMesh();}
void ATDCProceduralRoad::BuildRoadMesh(){
 if(!RoadMesh)return;RoadMesh->ClearAllMeshSections();const int32 N=FMath::Max(20,FMath::CeilToInt(RoadLength/SampleSpacing)),A=12;
 TArray<FVector> V,Norm;TArray<int32> Idx;TArray<FVector2D> UV;TArray<FProcMeshTangent> Tan;
 for(int32 I=0;I<=N;++I){float D=RoadLength*(float)I/N,T=D/RoadLength*2*PI;
 FVector C(D,CurveAmplitude*.45f*FMath::Sin(T),ElevationAmplitude*FMath::Sin(T)+ElevationAmplitude*.24f*FMath::Sin(2*T+.6f));
 FVector F=FVector(1,CurveAmplitude*.45f*2*PI/RoadLength*FMath::Cos(T),0).GetSafeNormal(),R=FVector(-F.Y,F.X,0).GetSafeNormal();
 float B=FMath::Sin(2*T)*FMath::DegreesToRadians(BankDegrees);FVector BR=R*FMath::Cos(B)+FVector::UpVector*FMath::Sin(B),BU=FVector::UpVector*FMath::Cos(B)-R*FMath::Sin(B);
 for(int32 J=0;J<=A;++J){float U=((float)J/A-.5f)*RoadWidth;V.Add(C+BR*U+BU*3);UV.Add(FVector2D((float)J/A*5,D/350));}}
 for(int32 I=0;I<N;++I)for(int32 J=0;J<A;++J){int32 X=I*(A+1)+J,Y=X+A+1;Idx.Append({X,Y,X+1,X+1,Y,Y+1});}
 RoadMesh->CreateMeshSection(0,V,Idx,Norm,UV,TArray<FColor>(),Tan,true);if(WetAsphaltMaterial)RoadMesh->SetMaterial(0,WetAsphaltMaterial);
}