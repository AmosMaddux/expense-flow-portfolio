from fastapi import FastAPI

from .service_health import ServiceHealth

app = FastAPI()


@app.get("/health")
async def health():
    """Return a bounded health payload for deployment and smoke checks."""
    return ServiceHealth(status="healthy", message="The service is live and healthy")


def main():
    """Run the local command-line entry point for the Python service."""
    print("Hello from expense-flow-project-team-3!")


if __name__ == "__main__":
    main()
