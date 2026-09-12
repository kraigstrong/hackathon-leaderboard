// Example client for the hackathon leaderboard. Copy submitScore into the
// evaluation binary and call it once the score is computed.
//
//	go run submit.go -game Wordle -team "Team Rocket" -score 0.1234 -seed 42 \
//	  -cost 32.9749 -cost-session 23420-f23e
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"
)

// Override with the LEADERBOARD_URL environment variable.
const defaultLeaderboardURL = "https://hackathon-leaderboard-alpha.vercel.app"

// The game types the leaderboard accepts; each has its own board.
const (
	GameWarmup = "Warmup"
	GameWordle = "Wordle"
)

type submission struct {
	Team     string  `json:"team"`
	Score    float64 `json:"score"`
	Seed     int64   `json:"seed"` // any integer type or a string works; the server stores it exactly
	GameType string  `json:"gameType"`

	// Optional cost reporting; omitted when not set.
	CostUSD     *float64 `json:"costUsd,omitempty"`
	CostSession string   `json:"costSession,omitempty"`
}

type submitResult struct {
	Rank int `json:"rank"`
	Best struct {
		Score float64 `json:"score"`
		Seed  string  `json:"seed"`
	} `json:"best"`
	Error string `json:"error"`
}

// submitScore posts one result and returns the team's current rank for that game type and seed.
// costUsd and costSession are optional: pass a nil costUsd and an empty costSession to leave them out.
func submitScore(gameType, team string, score float64, seed int64, costUsd *float64, costSession string) (*submitResult, error) {
	baseURL := os.Getenv("LEADERBOARD_URL")
	if baseURL == "" {
		baseURL = defaultLeaderboardURL
	}

	body, err := json.Marshal(submission{
		Team:        team,
		Score:       score,
		Seed:        seed,
		GameType:    gameType,
		CostUSD:     costUsd,
		CostSession: costSession,
	})
	if err != nil {
		return nil, err
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(baseURL+"/api/scores", "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("posting score: %w", err)
	}
	defer resp.Body.Close()

	var result submitResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("leaderboard returned HTTP %d with an unreadable body", resp.StatusCode)
	}
	if resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("leaderboard rejected score (HTTP %d): %s", resp.StatusCode, result.Error)
	}
	return &result, nil
}

func main() {
	game := flag.String("game", GameWarmup, "game type: "+GameWarmup+" or "+GameWordle)
	team := flag.String("team", "", "team name")
	score := flag.Float64("score", 0, "score (lower is better)")
	seed := flag.Int64("seed", 0, "seed used for the evaluation")
	cost := flag.Float64("cost", -1, "optional cost in USD; negative means don't report it")
	costSession := flag.String("cost-session", "", "optional cost session id")
	flag.Parse()
	if *team == "" {
		log.Fatal("-team is required")
	}

	var costUsd *float64
	if *cost >= 0 {
		costUsd = cost
	}

	result, err := submitScore(*game, *team, *score, *seed, costUsd, *costSession)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Submitted! %s is ranked #%d in %s on seed %s (best score %g)\n",
		*team, result.Rank, *game, result.Best.Seed, result.Best.Score)
}
