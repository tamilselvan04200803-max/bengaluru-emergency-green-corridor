// Copyright (c) 2026 Bengaluru Digital Twin Initiative. All Rights Reserved.

#include "HospitalPOIActor.h"
#include "TrafficClearance.h"

AHospitalPOIActor::AHospitalPOIActor()
{
	PrimaryActorTick.bCanEverTick = false;

	SceneRoot = CreateDefaultSubobject<USceneComponent>(TEXT("SceneRoot"));
	SetRootComponent(SceneRoot);

	EmergencyTier = TEXT("Level 1 Trauma Center");
	EmergencyBedCapacity = 24;
	bHasActiveTraumaCenter = true;
	ContactNumber = TEXT("108 / +91-80-26701150");
}

void AHospitalPOIActor::BeginPlay()
{
	Super::BeginPlay();

	UE_LOG(LogTrafficClearance, Log, TEXT("AHospitalPOIActor [%s - %s]: Initialized with %d emergency beds. Trauma Ready: %s."),
		*HospitalId, *HospitalName, EmergencyBedCapacity, bHasActiveTraumaCenter ? TEXT("TRUE") : TEXT("FALSE"));
}

void AHospitalPOIActor::SetNearestRoadReference(USplineComponent* RoadSpline, const FVector& IngressPoint)
{
	NearestRoadSpline = RoadSpline;
	NearestRoadIngressPoint = IngressPoint;

	UE_LOG(LogTrafficClearance, Log, TEXT("AHospitalPOIActor [%s]: Associated with nearest road spline. Ingress: X=%.1f, Y=%.1f, Z=%.1f"),
		*HospitalId, IngressPoint.X, IngressPoint.Y, IngressPoint.Z);
}
