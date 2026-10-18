#include "TDCPlayerCar.h"

#include "TDCChaseCameraComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/InputComponent.h"
#include "Engine/StaticMesh.h"
#include "UObject/ConstructorHelpers.h"

namespace
{
	/** Unreal physics works in centimetres and kilograms, so one newton is
	 *  1 kg*m/s^2 = 100 kg*cm/s^2. Everything below is authored in SI and
	 *  converted here, exactly once. */
	constexpr float NewtonToUnrealForce = 100.0f;
	constexpr float CmPerMetre = 100.0f;
	constexpr float Gravity = 9.81f;

	/** The placeholder body cube is 62 cm tall, so its centre is 31 cm above its
	 *  base. Wheels are placed so their bottoms line up with the base. */
	constexpr float PlaceholderBodyHalfHeight = 31.0f;
}

ATDCPlayerCar::ATDCPlayerCar()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickGroup = TG_PrePhysics; // forces must land before the solver runs

	bUseControllerRotationYaw = false;
	AutoPossessPlayer = EAutoReceiveInput::Player0;

	Body = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Body"));
	SetRootComponent(Body);
	Body->SetSimulatePhysics(true);
	Body->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
	Body->SetCollisionProfileName(TEXT("PhysicsActor"));
	Body->SetEnableGravity(true);
	Body->SetNotifyRigidBodyCollision(true);
	Body->SetMassOverrideInKg(NAME_None, MassKg, true);

	// Damping is deliberately near zero. The starter used 0.12 linear / 1.8
	// angular, which is right for a toy force model but fights a real tyre
	// solver: heavy angular damping would stop the car rotating into a slide.
	Body->SetLinearDamping(0.0f);
	Body->SetAngularDamping(0.05f);

	// Fallback mesh so the car is visible before you assign a real one.
	static ConstructorHelpers::FObjectFinder<UStaticMesh> BodyMesh(TEXT("/Engine/BasicShapes/Cube.Cube"));
	if (BodyMesh.Succeeded())
	{
		Body->SetStaticMesh(BodyMesh.Object);
		Body->SetRelativeScale3D(FVector(4.6f, 2.0f, 0.62f)); // 4.6 m x 2.0 m x 0.62 m
	}

	// Four visual wheels, created in the same order GetWheelContactLocation uses:
	// 0 front left, 1 front right, 2 rear left, 3 rear right.
	static ConstructorHelpers::FObjectFinder<UStaticMesh> WheelMesh(TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
	const float HalfWheelBase = WheelBase * 0.5f;
	const float HalfTrack = TrackWidth * 0.5f;
	const float WheelLocalZ = -PlaceholderBodyHalfHeight + WheelRadius;
	const FVector WheelOffsets[4] = {
		FVector(HalfWheelBase, -HalfTrack, WheelLocalZ),
		FVector(HalfWheelBase, HalfTrack, WheelLocalZ),
		FVector(-HalfWheelBase, -HalfTrack, WheelLocalZ),
		FVector(-HalfWheelBase, HalfTrack, WheelLocalZ)
	};

	Wheels.Reserve(4);
	for (int32 i = 0; i < 4; ++i)
	{
		const FName WheelName(*FString::Printf(TEXT("Wheel%d"), i));
		UStaticMeshComponent* Wheel = CreateDefaultSubobject<UStaticMeshComponent>(WheelName);
		Wheel->SetupAttachment(Body);
		Wheel->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Wheel->SetGenerateOverlapEvents(false);
		Wheel->SetRelativeLocation(WheelOffsets[i]);
		Wheel->SetRelativeScale3D(FVector(WheelRadius / 50.0f, WheelRadius / 50.0f, 0.22f));
		// The engine cylinder is Z-up; roll it 90 degrees so it reads as a wheel.
		Wheel->SetRelativeRotation(FRotator(0.0f, 0.0f, 90.0f));
		if (WheelMesh.Succeeded())
		{
			Wheel->SetStaticMesh(WheelMesh.Object);
		}
		Wheels.Add(Wheel);
	}

	ChaseCamera = CreateDefaultSubobject<UTDCChaseCameraComponent>(TEXT("ChaseCamera"));
	ChaseCamera->SetupAttachment(Body);
	// Keep the camera's speed blend in step with the car's top speed.
	ChaseCamera->ReferenceTopSpeedKmh = MaxSpeedKmh;
}

void ATDCPlayerCar::BeginPlay()
{
	Super::BeginPlay();

	if (Body)
	{
		Body->SetMassOverrideInKg(NAME_None, FMath::Max(1.0f, MassKg), true);
	}
}

void ATDCPlayerCar::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);

	if (!PlayerInputComponent)
	{
		return;
	}

	// Axis and action names match Config/DefaultInput.ini exactly.
	PlayerInputComponent->BindAxis(TEXT("Throttle"), this, &ATDCPlayerCar::SetThrottle);
	PlayerInputComponent->BindAxis(TEXT("Steer"), this, &ATDCPlayerCar::SetSteer);
	PlayerInputComponent->BindAxis(TEXT("Brake"), this, &ATDCPlayerCar::SetBrake);
	PlayerInputComponent->BindAction(TEXT("Handbrake"), IE_Pressed, this, &ATDCPlayerCar::HBDown);
	PlayerInputComponent->BindAction(TEXT("Handbrake"), IE_Released, this, &ATDCPlayerCar::HBUp);
}

void ATDCPlayerCar::SetThrottle(float Value)
{
	// The starter limited reverse to 35% so S is a manoeuvring gear, not a
	// second racing direction. Keep that behaviour, now as a property.
	ThrottleInput = FMath::Clamp(Value, -FMath::Clamp(MaxReverseThrottle, 0.0f, 1.0f), 1.0f);
}

void ATDCPlayerCar::SetSteer(float Value)
{
	SteeringInput = FMath::Clamp(Value, -1.0f, 1.0f);
}

void ATDCPlayerCar::SetBrake(float Value)
{
	// The starter treated this as a binary bool (Value > 0.1). Keeping it as a
	// float means an analog trigger or a gamepad axis can do partial braking.
	BrakeInput = FMath::Clamp(Value, 0.0f, 1.0f);
}

void ATDCPlayerCar::HBDown()
{
	bHandbrake = true;
}

void ATDCPlayerCar::HBUp()
{
	bHandbrake = false;
}

void ATDCPlayerCar::ApplyForceAtLocationSI(const FVector& ForceN, const FVector& WorldLocation, float DeltaTime)
{
	if (!Body || DeltaTime <= 0.0f)
	{
		return;
	}
	// AddImpulseAtLocation expects kg*cm/s. ForceN * 100 converts newtons to
	// kg*cm/s^2, and multiplying by DeltaTime turns a force into an impulse.
	Body->AddImpulseAtLocation(ForceN * (NewtonToUnrealForce * DeltaTime), WorldLocation);
}

FVector ATDCPlayerCar::GetWheelContactLocation(int32 WheelIndex) const
{
	if (!Body)
	{
		return FVector::ZeroVector;
	}

	const float HalfWheelBase = WheelBase * 0.5f;
	const float HalfTrack = TrackWidth * 0.5f;

	// Unreal is left-handed: +X is forward, +Y is right, +Z is up.
	FVector Local;
	switch (WheelIndex)
	{
	case 0: Local = FVector(HalfWheelBase, -HalfTrack, 0.0f); break;  // front left
	case 1: Local = FVector(HalfWheelBase, HalfTrack, 0.0f); break;   // front right
	case 2: Local = FVector(-HalfWheelBase, -HalfTrack, 0.0f); break; // rear left
	default: Local = FVector(-HalfWheelBase, HalfTrack, 0.0f); break; // rear right
	}

	// Contact patch sits a wheel radius below the axle.
	Local.Z = -WheelRadius;
	return Body->GetComponentTransform().TransformPosition(Local);
}

float ATDCPlayerCar::GetSpeedKmh() const
{
	if (!Body)
	{
		return 0.0f;
	}
	const FVector VelocityMs = Body->GetPhysicsLinearVelocity() * (1.0f / CmPerMetre);
	return FVector::DotProduct(VelocityMs, GetActorForwardVector()) * 3.6f;
}

float ATDCPlayerCar::GetAbsoluteSpeedKmh() const
{
	return Body ? Body->GetPhysicsLinearVelocity().Size() * 0.036f : 0.0f;
}

float ATDCPlayerCar::GetSpeed01() const
{
	const float Reference = FMath::Max(1.0f, MaxSpeedKmh);
	return FMath::Clamp(GetAbsoluteSpeedKmh() / Reference, 0.0f, 1.0f);
}

bool ATDCPlayerCar::IsDrifting() const
{
	return GetAbsoluteSpeedKmh() > 30.0f && FMath::Abs(GetRearSlipAngleDeg()) > 12.0f;
}

void ATDCPlayerCar::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	if (!Body)
	{
		return;
	}

	const float ForwardSpeedMs = FVector::DotProduct(
		Body->GetPhysicsLinearVelocity() * (1.0f / CmPerMetre),
		GetActorForwardVector());

	if (!bPhysicsEnabled || !Body->IsSimulatingPhysics() || DeltaSeconds <= KINDA_SMALL_NUMBER)
	{
		UpdateWheelVisuals(DeltaSeconds, ForwardSpeedMs);
		return;
	}

	// ---- Basis and current motion state ---------------------------------
	const FVector Forward = GetActorForwardVector();
	const FVector Right = GetActorRightVector();
	const FVector Up = GetActorUpVector();

	const FVector VelocityMs = Body->GetPhysicsLinearVelocity() * (1.0f / CmPerMetre);
	const float VLong = FVector::DotProduct(VelocityMs, Forward);
	const float VLat = FVector::DotProduct(VelocityMs, Right);
	const float Speed = VelocityMs.Size();
	const float SpeedKmh = Speed * 3.6f;
	const float YawRate = FVector::DotProduct(Body->GetPhysicsAngularVelocityInRadians(), Up);

	// ---- Steering --------------------------------------------------------
	const float MaxSteerRad = FMath::DegreesToRadians(MaxSteerAngle);
	const float SpeedFraction = FMath::Clamp(SpeedKmh / FMath::Max(1.0f, MaxSpeedKmh), 0.0f, 1.0f);
	const float SteerLimit = MaxSteerRad * (1.0f - HighSpeedSteerReduction * SpeedFraction);
	const float SteerTarget = FMath::Clamp(SteeringInput, -1.0f, 1.0f) * SteerLimit;
	SteerAngle = FMath::FInterpTo(SteerAngle, SteerTarget, DeltaSeconds, SteerInterpSpeed);

	// ---- Grip available this frame --------------------------------------
	const float Mu = FMath::Lerp(DryFrictionCoefficient, WetGrip, FMath::Clamp(Wetness, 0.0f, 1.0f));
	const float RearMu = Mu
		* (bHandbrake ? HandbrakeGripScale : 1.0f)
		* (1.0f - ThrottleGripLoss * FMath::Max(0.0f, ThrottleInput));

	// ---- Axle geometry (metres, measured from the centre of gravity) -----
	const float HalfWheelBaseM = (WheelBase * 0.5f) / CmPerMetre;
	const float DistanceFrontAxle = HalfWheelBaseM;
	const float DistanceRearAxle = HalfWheelBaseM;

	// ---- Slip angles -----------------------------------------------------
	// At very low speed the slip formula divides by ~0 and explodes, so clamp
	// the reference speed. Below ~3.6 km/h the car behaves quasi-statically.
	const float LongReference = FMath::Max(FMath::Abs(VLong), 1.0f);
	const float AlphaFront = FMath::Atan2(VLat + YawRate * DistanceFrontAxle, LongReference) - SteerAngle;
	const float AlphaRear = FMath::Atan2(VLat - YawRate * DistanceRearAxle, LongReference);
	RearSlipAngle = AlphaRear;

	// ---- Vertical load, including aero downforce -------------------------
	const float Weight = MassKg * Gravity;
	const float Downforce = DownforceCoefficient * Speed * Speed;
	const float TotalLoad = Weight + Downforce;
	const float FrontAxleLoad = TotalLoad * FrontWeightBias;
	const float RearAxleLoad = TotalLoad * (1.0f - FrontWeightBias);

	// ---- Lateral (cornering) forces, limited by the friction circle ------
	float LateralFront = -FrontCorneringStiffness * AlphaFront;
	float LateralRear = -RearCorneringStiffness * AlphaRear;
	LateralFront = FMath::Clamp(LateralFront, -Mu * FrontAxleLoad, Mu * FrontAxleLoad);
	LateralRear = FMath::Clamp(LateralRear, -RearMu * RearAxleLoad, RearMu * RearAxleLoad);

	LateralFront *= LateralForceSign;
	LateralRear *= LateralForceSign;

	// Half the axle force at each of the two wheels. Because the wheels sit
	// either side of the centreline, this produces the yaw moment for free.
	for (int32 i = 0; i < 2; ++i)
	{
		ApplyForceAtLocationSI(Right * (LateralFront * 0.5f), GetWheelContactLocation(i), DeltaSeconds);
	}
	for (int32 i = 2; i < 4; ++i)
	{
		ApplyForceAtLocationSI(Right * (LateralRear * 0.5f), GetWheelContactLocation(i), DeltaSeconds);
	}

	// ---- Longitudinal: engine, brakes, drag, rolling resistance ----------
	const float MaxSpeedMs = MaxSpeedKmh / 3.6f;
	const float TorqueFraction = 1.0f - 0.55f * FMath::Square(SpeedFraction);
	float Longitudinal = ThrottleInput * TorqueFraction * MaxEngineForce;

	// Soft ceiling: stop adding power once the target top speed is reached.
	if (ThrottleInput > 0.0f && VLong > MaxSpeedMs)
	{
		Longitudinal = FMath::Min(Longitudinal, 0.0f);
	}

	// Resist the engine when it is fighting the direction of travel.
	if (FMath::Abs(VLong) > 1.0f
		&& !FMath::IsNearlyZero(ThrottleInput)
		&& FMath::Sign(ThrottleInput) != FMath::Sign(VLong))
	{
		Longitudinal *= (1.0f - FMath::Clamp(ReverseThrottleResistance, 0.0f, 1.0f));
	}

	if (BrakeInput > 0.0f && FMath::Abs(VLong) > 0.2f)
	{
		Longitudinal -= FMath::Sign(VLong) * BrakeInput * MaxBrakeForce;
	}

	if (bHandbrake && FMath::Abs(VLong) > 0.2f)
	{
		Longitudinal -= FMath::Sign(VLong) * MaxBrakeForce * 0.35f;
	}

	// Drag and rolling resistance always oppose motion.
	Longitudinal -= FMath::Sign(VLong) * DragCoefficient * VLong * VLong;
	Longitudinal -= RollingResistance * VLong;

	// Rear-wheel drive, so propulsion goes through the rear contact patches.
	// Under throttle that is what makes the tail step out.
	ApplyForceAtLocationSI(Forward * (Longitudinal * 0.5f), GetWheelContactLocation(2), DeltaSeconds);
	ApplyForceAtLocationSI(Forward * (Longitudinal * 0.5f), GetWheelContactLocation(3), DeltaSeconds);

	// ---- Downforce -------------------------------------------------------
	if (Downforce > 0.0f)
	{
		ApplyForceAtLocationSI(-Up * Downforce, Body->GetComponentLocation(), DeltaSeconds);
	}

	UpdateWheelVisuals(DeltaSeconds, VLong);
}

void ATDCPlayerCar::UpdateWheelVisuals(float DeltaTime, float ForwardSpeedMs)
{
	if (Wheels.Num() < 4 || WheelRadius <= KINDA_SMALL_NUMBER || DeltaTime <= 0.0f)
	{
		return;
	}

	// angular speed = v / r
	WheelSpin += (ForwardSpeedMs / (WheelRadius / CmPerMetre)) * DeltaTime;

	const float SpinDegrees = FMath::RadiansToDegrees(WheelSpin);
	const float SteerDegrees = FMath::RadiansToDegrees(SteerAngle);

	for (int32 i = 0; i < 4; ++i)
	{
		if (!Wheels[i])
		{
			continue;
		}
		// FRotator(Pitch, Yaw, Roll): pitch spins the wheel, yaw steers it, and
		// the 90 degree roll matches the engine cylinder's Z-up orientation.
		const bool bIsFrontWheel = (i < 2);
		Wheels[i]->SetRelativeRotation(FRotator(SpinDegrees, bIsFrontWheel ? SteerDegrees : 0.0f, 90.0f));
	}
}
