"""Drop Instagram videos: its embed is a post card that doesn't fit the reel player."""
from django.db import migrations, models


def delete_instagram_videos(apps, schema_editor):
    RestaurantVideo = apps.get_model("restaurants", "RestaurantVideo")
    RestaurantVideo.objects.filter(platform="instagram").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("restaurants", "0005_rebuild_video_table"),
    ]

    operations = [
        migrations.RunPython(delete_instagram_videos, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="restaurantvideo",
            name="platform",
            field=models.CharField(
                choices=[("tiktok", "TikTok"), ("youtube", "YouTube")], max_length=20
            ),
        ),
    ]
