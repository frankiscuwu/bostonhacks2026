from django.contrib import admin
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase, SimpleTestCase
from rest_framework.test import APIClient

from .models import Restaurant, RestaurantVideo
from .tests import restaurant_data
from .video_urls import canonicalize_video_url


YOUTUBE_ID = 'M7lc1UVf-VE'
TIKTOK_ID = '6718335390845095173'
INSTAGRAM_ID = 'AbC12_def-3'


class VideoURLTests(SimpleTestCase):
    def test_youtube_formats(self):
        for url in (
            f'https://www.youtube.com/shorts/{YOUTUBE_ID}?si=tracking',
            f'https://youtube.com/watch?v={YOUTUBE_ID}&t=20',
            f'https://m.youtube.com/watch?v={YOUTUBE_ID}',
            f'https://youtu.be/{YOUTUBE_ID}?si=tracking#t=20',
            f'https://www.youtube.com/embed/{YOUTUBE_ID}',
        ):
            with self.subTest(url=url):
                self.assertEqual(canonicalize_video_url('youtube', url),
                                 (f'https://www.youtube.com/watch?v={YOUTUBE_ID}', YOUTUBE_ID))

    def test_tiktok_formats(self):
        for host in ('www.tiktok.com', 'tiktok.com', 'm.tiktok.com'):
            self.assertEqual(canonicalize_video_url('tiktok', f'https://{host}/@test.creator/video/{TIKTOK_ID}/?is_from_webapp=1'),
                             (f'https://www.tiktok.com/@test.creator/video/{TIKTOK_ID}', TIKTOK_ID))

    def test_instagram_formats(self):
        for host in ('www.instagram.com', 'instagram.com', 'm.instagram.com'):
            self.assertEqual(canonicalize_video_url('instagram', f'https://{host}/reel/{INSTAGRAM_ID}/?igsh=tracking'),
                             (f'https://www.instagram.com/reel/{INSTAGRAM_ID}/', INSTAGRAM_ID))

    def test_invalid_or_unsupported_urls(self):
        invalid = [
            ('youtube', 'http://www.youtube.com/shorts/' + YOUTUBE_ID),
            ('youtube', 'javascript:alert(1)'),
            ('youtube', 'https://www.youtube.com.evil.example/shorts/' + YOUTUBE_ID),
            ('youtube', 'https://evil.example/?url=https://youtube.com/watch?v=' + YOUTUBE_ID),
            ('youtube', 'https://youtube.com@evil.example/shorts/' + YOUTUBE_ID),
            ('youtube', 'https://user:password@youtube.com/shorts/' + YOUTUBE_ID),
            ('youtube', 'https://youtube.com:443/shorts/' + YOUTUBE_ID),
            ('youtube', 'https://youtube.com:bad/shorts/' + YOUTUBE_ID),
            ('youtube', 'https://youtube.com/shorts/too-short'),
            ('youtube', 'https://youtube.com/shorts/' + YOUTUBE_ID + '/extra'),
            ('youtube', f'https://youtube.com/watch?v={YOUTUBE_ID}&v={YOUTUBE_ID}'),
            ('youtube', f'https://youtube.com/watch?v={YOUTUBE_ID}&v='),
            ('youtube', 'https://youtube.com/playlist?list=example'),
            ('youtube', 'https://youtube.com/watch'),
            ('youtube', 'https://youtube.com/shorts/\n' + YOUTUBE_ID),
            ('youtube', 'https://youtube.com\\@evil.example/shorts/' + YOUTUBE_ID),
            ('tiktok', 'https://vm.tiktok.com/short-link/'),
            ('tiktok', 'https://www.tiktok.com/@creator'),
            ('tiktok', 'https://www.tiktok.com/@creator/video/not-numeric'),
            ('instagram', 'https://www.instagram.com/p/' + INSTAGRAM_ID + '/'),
            ('instagram', 'https://www.instagram.com/reel/'),
            ('instagram', 'https://www.instagram.com/reel/abc/extra'),
            ('instagram', 'https://www.instagram.com/stories/creator/123/'),
            ('instagram', 'https://www.youtube.com/shorts/' + YOUTUBE_ID),
            ('other', 'https://www.youtube.com/shorts/' + YOUTUBE_ID),
        ]
        for platform, url in invalid:
            with self.subTest(platform=platform, url=url):
                with self.assertRaises(ValidationError):
                    canonicalize_video_url(platform, url)


class RestaurantVideoTests(TestCase):
    def setUp(self):
        self.restaurant = Restaurant.objects.create(**restaurant_data())
        self.client = APIClient()
        self.path = f'/api/restaurants/{self.restaurant.id}/videos/'

    def video(self, **overrides):
        return RestaurantVideo.objects.create(**(dict(
            restaurant=self.restaurant, platform='youtube',
            canonical_url=f'https://youtu.be/{YOUTUBE_ID}?si=tracking',
            creator_name='Test creator', creator_handle='@test',
        ) | overrides))

    def test_pending_by_default_and_normalized(self):
        before = Restaurant.objects.values().get(pk=self.restaurant.pk)
        video = self.video()
        self.assertEqual(video.verification_status, 'pending')
        self.assertEqual(video.platform_video_id, YOUTUBE_ID)
        self.assertEqual(video.canonical_url, f'https://www.youtube.com/watch?v={YOUTUBE_ID}')
        self.assertIsNotNone(video.created_at)
        self.assertIsNotNone(video.updated_at)
        self.assertTrue(RestaurantVideo._meta.managed)
        self.assertFalse(RestaurantVideo._meta.get_field('restaurant').db_constraint)
        self.assertEqual(Restaurant.objects.values().get(pk=self.restaurant.pk), before)
        self.assertEqual(self.client.get(self.path).json(), [])

    def test_only_approved_multiple_videos_and_restaurant_isolation(self):
        first = self.video(verification_status='approved')
        second = self.video(platform='tiktok', canonical_url=f'https://www.tiktok.com/@test/video/{TIKTOK_ID}', verification_status='approved')
        self.video(platform='instagram', canonical_url=f'https://www.instagram.com/reel/{INSTAGRAM_ID}/', verification_status='rejected')
        self.video(canonical_url='https://www.youtube.com/shorts/abcdefghijk')
        other = Restaurant.objects.create(**restaurant_data(dbaname='Other'))
        self.video(restaurant=other, verification_status='approved')
        response = self.client.get(self.path + '?verification_status=pending')
        self.assertEqual(response.status_code, 200)
        rows = response.json()
        self.assertEqual([r['id'] for r in rows], [first.pk, second.pk])
        self.assertEqual(set(rows[0]), {'id','restaurant_id','platform','canonical_url','platform_video_id',
                         'creator_name','creator_handle','verification_status','created_at','updated_at'})
        self.assertEqual(rows[0]['restaurant_id'], self.restaurant.pk)
        self.assertEqual(rows[0]['verification_status'], 'approved')

    def test_existing_restaurant_without_videos_and_missing_restaurant(self):
        self.assertEqual(self.client.get(self.path).json(), [])
        self.assertEqual(self.client.get('/api/restaurants/999999/videos/').status_code, 404)
        self.assertEqual(self.client.get('/api/restaurants/999999999999999999999999999/videos/').status_code, 404)

    def test_public_write_methods_not_allowed(self):
        for method in ('post', 'put', 'patch', 'delete'):
            response = getattr(self.client, method)(self.path, {'verification_status':'approved'}, format='json')
            self.assertEqual(response.status_code, 405)
        self.assertFalse(RestaurantVideo.objects.exists())

    def test_invalid_models_are_not_saved(self):
        for overrides in (dict(platform='instagram'), dict(canonical_url='https://evil.example/video'),
                          dict(verification_status='published'), dict(restaurant_id=999999, restaurant=None)):
            with self.subTest(overrides=overrides):
                with self.assertRaises(ValidationError):
                    self.video(**overrides)
        self.assertFalse(RestaurantVideo.objects.exists())

    def test_duplicate_aliases_rejected_but_video_can_belong_to_multiple_restaurants(self):
        self.video()
        with self.assertRaises(ValidationError):
            self.video(canonical_url=f'https://www.youtube.com/shorts/{YOUTUBE_ID}')
        other = Restaurant.objects.create(**restaurant_data(dbaname='Other'))
        self.video(restaurant=other)
        self.assertEqual(RestaurantVideo.objects.count(), 2)

    def test_database_duplicate_constraint(self):
        video = self.video()
        # bulk_create bypasses validation: verify the actual uniqueness constraint.
        with self.assertRaises(IntegrityError), transaction.atomic():
            RestaurantVideo.objects.bulk_create([RestaurantVideo(
                restaurant=self.restaurant, platform='youtube', canonical_url=video.canonical_url,
                platform_video_id=video.platform_video_id,
            )])

    def test_approval_and_unpublishing(self):
        video = self.video()
        video.verification_status = 'approved'
        video.save(update_fields=['verification_status'])
        self.assertEqual(len(self.client.get(self.path).json()), 1)
        video.verification_status = 'pending'
        video.save(update_fields=['verification_status'])
        self.assertEqual(self.client.get(self.path).json(), [])

    def test_admin_form_canonicalizes_and_derives_id(self):
        from django.test import RequestFactory
        from django.contrib.auth.models import User
        request = RequestFactory().get('/admin/restaurants/restaurantvideo/add/')
        request.user = User(is_staff=True, is_superuser=True)
        model_admin = admin.site._registry[RestaurantVideo]
        form = model_admin.get_form(request)(data={
            'restaurant':self.restaurant.pk, 'platform':'youtube',
            'canonical_url':f'https://youtu.be/{YOUTUBE_ID}', 'creator_name':'',
            'creator_handle':'', 'verification_status':'pending',
        })
        self.assertTrue(form.is_valid(), form.errors)
        video = form.save()
        self.assertEqual(video.platform_video_id, YOUTUBE_ID)
        self.assertEqual(video.verification_status, 'pending')
        self.assertIn('platform_video_id', model_admin.readonly_fields)

    def test_url_update_rederives_platform_id(self):
        video = self.video()
        video.canonical_url = 'https://youtube.com/shorts/abcdefghijk'
        video.save(update_fields=['canonical_url'])
        video.refresh_from_db()
        self.assertEqual(video.platform_video_id, 'abcdefghijk')
