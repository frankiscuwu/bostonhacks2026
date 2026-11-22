"""Warm public MBTA topology without reading or writing the database."""
from django.core.management.base import BaseCommand, CommandError

from transit.client import MBTAUnavailable
from transit.network import get_network


class Command(BaseCommand):
    help = "Warm cached MBTA rail topology (HTTP reads only; no database queries)."

    def handle(self, *args, **options):
        try:
            network = get_network()
        except MBTAUnavailable as exc:
            raise CommandError(f"MBTA topology unavailable ({exc.code}). Check MBTA_API_KEY and retry later.") from None
        self.stdout.write(self.style.SUCCESS(
            f"MBTA topology ready: {len(network['stations'])} stations, {len(network['patterns'])} directed patterns; "
            f"routes: {', '.join(network['available_routes'])}."
        ))
