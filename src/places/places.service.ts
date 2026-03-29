// places.service.ts
import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class PlacesService {
    private readonly apiKey: string;
    private readonly apiUrl = 'https://places.googleapis.com/v1/places:searchNearby';

    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService,
    ) {
        const apiKey = this.configService.get<string>('GOOGLE_PLACES_API_KEY');

        if (!apiKey) {
            throw new Error('GOOGLE_PLACES_API_KEY is not defined in .env file.');
        }

        this.apiKey = apiKey;
    }

    async searchNearbyRestaurants(lat: number, lng: number) {
        const requestBody = {
            includedPrimaryTypes: ['restaurant'], // 핵심: 레스토랑 유형 지정
            maxResultCount: 10, // 가져올 결과 수
            locationRestriction: {
                circle: {
                    center: {
                        latitude: lat,
                        longitude: lng,
                    },
                    radius: 500.0, // 500미터 반경
                },
            },
        };

        const { data } = await firstValueFrom(
            this.httpService.post(
                this.apiUrl,
                requestBody,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Goog-Api-Key': this.apiKey,
                        // 중요: 필요한 필드만 요청하여 비용 절감
                        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location',
                    },
                }
            )
        );

        return data;
    }
}