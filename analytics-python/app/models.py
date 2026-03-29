from pydantic import BaseModel, Field


class AnalyzeRequest(BaseModel):
    ticker: str = Field(..., description="Indonesian ticker like BBRI or BBRI.JK")
    period: str = Field(default="3mo", description="1mo | 3mo | 6mo")
