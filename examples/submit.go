// Example client for the hackathon leaderboard. Copy submitScore into the
// evaluation binary and call it once the score is computed.
//
//	go run submit.go -game Wordle -team "Team Rocket" -score 0.1234 -seed 42
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
func submitScore(gameType, team string, score float64, seed int64) (*submitResult, error) {
	baseURL := os.Getenv("LEADERBOARD_URL")
	if baseURL == "" {
		baseURL = defaultLeaderboardURL
	}

	body, err := json.Marshal(submission{Team: team, Score: score, Seed: seed, GameType: gameType})
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
	flag.Parse()
	if *team == "" {
		log.Fatal("-team is required")
	}

	result, err := submitScore(*game, *team, *score, *seed)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Submitted! %s is ranked #%d in %s on seed %s (best score %g)\n",
		*team, result.Rank, *game, result.Best.Seed, result.Best.Score)
}
