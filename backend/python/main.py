from fastapi import FastAPI
from .service_health import ServiceHealth

app = FastAPI()

@app.get("/health")
async def health():
    return ServiceHealth(status="healthy", message="The service is live and healthy")

def main():
    print("Hello from expense-flow-project-team-3!")


if __name__ == "__main__":
    main()
