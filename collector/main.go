package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

// ──────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────

const (
	okxWSURL    = "wss://ws.okx.com:8443/ws/v5/public"
	sockPath    = "/tmp/caloogy_collector.sock"
	pingEvery   = 20 * time.Second
	reconnectIn = 3 * time.Second
)

// symbols for standard intervals (1H/4H/1D).
var symbols = []struct{ name, instId string }{
	{"BTCUSDT", "BTC-USDT"},
	{"ETHUSDT", "ETH-USDT"},
	{"SOLUSDT", "SOL-USDT"},
	{"BNBUSDT", "BNB-USDT"},
	{"XRPUSDT", "XRP-USDT"},
}

// liveSymbols for high-frequency intervals (1s/1min) — BTC/ETH/SOL only.
var liveSymbols = []struct{ name, instId string }{
	{"BTCUSDT", "BTC-USDT"},
	{"ETHUSDT", "ETH-USDT"},
	{"SOLUSDT", "SOL-USDT"},
}

// intervals maps interval label → OKX channel name.
var intervals = []struct{ label, channel string }{
	{"1H", "candle1H"},
	{"4H", "candle4H"},
	{"1D", "candle1D"},
}

// liveIntervals for high-frequency streaming.
var liveIntervals = []struct{ label, channel string }{
	{"1s",   "candle1s"},
	{"1min", "candle1m"},
}

// ──────────────────────────────────────────────
// Candle (output to Node.js)
// ──────────────────────────────────────────────

type Candle struct {
	Symbol    string  `json:"symbol"`
	Interval  string  `json:"interval"`
	Ts        int64   `json:"ts"`
	Open      float64 `json:"open"`
	High      float64 `json:"high"`
	Low       float64 `json:"low"`
	Close     float64 `json:"close"`
	Volume    float64 `json:"volume"`
	Confirmed bool    `json:"confirmed"`
}

// ──────────────────────────────────────────────
// Hub — broadcasts candles to all Node.js conns
// ──────────────────────────────────────────────

type Hub struct {
	mu    sync.Mutex
	conns map[net.Conn]struct{}
}

func newHub() *Hub {
	return &Hub{conns: make(map[net.Conn]struct{})}
}

func (h *Hub) add(c net.Conn) {
	h.mu.Lock()
	h.conns[c] = struct{}{}
	h.mu.Unlock()
	log.Printf("[hub] Node.js client connected (%s)", c.RemoteAddr())
}

func (h *Hub) remove(c net.Conn) {
	h.mu.Lock()
	delete(h.conns, c)
	h.mu.Unlock()
	c.Close()
	log.Printf("[hub] Node.js client disconnected")
}

func (h *Hub) broadcast(candle *Candle) {
	data, err := json.Marshal(candle)
	if err != nil {
		log.Printf("[hub] marshal error: %v", err)
		return
	}
	data = append(data, '\n')

	h.mu.Lock()
	var dead []net.Conn
	for c := range h.conns {
		if _, err := c.Write(data); err != nil {
			dead = append(dead, c)
		}
	}
	h.mu.Unlock()

	for _, c := range dead {
		h.remove(c)
	}
}

// ──────────────────────────────────────────────
// Unix socket server
// ──────────────────────────────────────────────

func runSocketServer(ctx context.Context, hub *Hub) {
	_ = os.Remove(sockPath)

	ln, err := net.Listen("unix", sockPath)
	if err != nil {
		log.Fatalf("[socket] listen error: %v", err)
	}
	log.Printf("[socket] listening on %s", sockPath)

	go func() {
		<-ctx.Done()
		ln.Close()
	}()

	for {
		conn, err := ln.Accept()
		if err != nil {
			select {
			case <-ctx.Done():
				return
			default:
				log.Printf("[socket] accept error: %v", err)
				continue
			}
		}
		hub.add(conn)
		go func(c net.Conn) {
			buf := make([]byte, 256)
			for {
				if _, err := c.Read(buf); err != nil {
					hub.remove(c)
					return
				}
			}
		}(conn)
	}
}

// ──────────────────────────────────────────────
// OKX WebSocket messages
// ──────────────────────────────────────────────

type subArg struct {
	Channel string `json:"channel"`
	InstId  string `json:"instId"`
}

type subMsg struct {
	Op   string   `json:"op"`
	Args []subArg `json:"args"`
}

type okxMsg struct {
	Arg struct {
		Channel string `json:"channel"`
		InstId  string `json:"instId"`
	} `json:"arg"`
	Data [][]string `json:"data"`
}

// ──────────────────────────────────────────────
// Single WebSocket worker
// ──────────────────────────────────────────────

func runWorker(ctx context.Context, hub *Hub, sym, instId, interval, channel string, emitLive bool) {
	tag := fmt.Sprintf("[%s/%s]", sym, interval)

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		if err := connectAndStream(ctx, hub, sym, instId, interval, channel, tag, emitLive); err != nil {
			log.Printf("%s disconnected: %v — reconnecting in %s", tag, err, reconnectIn)
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(reconnectIn):
		}
	}
}

func connectAndStream(
	ctx context.Context,
	hub *Hub,
	sym, instId, interval, channel, tag string,
	emitLive bool,
) error {
	dialer := websocket.DefaultDialer
	conn, _, err := dialer.DialContext(ctx, okxWSURL, nil)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()
	log.Printf("%s connected to OKX", tag)

	msg := subMsg{
		Op:   "subscribe",
		Args: []subArg{{Channel: channel, InstId: instId}},
	}
	if err := conn.WriteJSON(msg); err != nil {
		return fmt.Errorf("subscribe: %w", err)
	}

	pingTicker := time.NewTicker(pingEvery)
	defer pingTicker.Stop()

	type readResult struct {
		msgType int
		data    []byte
		err     error
	}
	readCh := make(chan readResult, 4)
	go func() {
		for {
			mt, data, err := conn.ReadMessage()
			readCh <- readResult{mt, data, err}
			if err != nil {
				return
			}
		}
	}()

	for {
		select {
		case <-ctx.Done():
			conn.WriteMessage(websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
			return nil

		case <-pingTicker.C:
			if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"op":"ping"}`)); err != nil {
				return fmt.Errorf("ping: %w", err)
			}

		case r := <-readCh:
			if r.err != nil {
				return fmt.Errorf("read: %w", r.err)
			}
			if r.msgType != websocket.TextMessage {
				continue
			}
			handleMessage(r.data, hub, sym, interval, tag, emitLive)
		}
	}
}

// ──────────────────────────────────────────────
// Message parsing
// ──────────────────────────────────────────────

func handleMessage(raw []byte, hub *Hub, sym, interval, tag string, emitLive bool) {
	var m okxMsg
	if err := json.Unmarshal(raw, &m); err != nil {
		return
	}
	if len(m.Data) == 0 {
		return
	}

	for _, row := range m.Data {
		// row: [ts, open, high, low, close, vol, volCcy, volCcyQuote, confirm]
		if len(row) < 9 {
			continue
		}
		confirmed := row[8] == "1"
		if !confirmed && !emitLive {
			continue
		}

		ts, err := strconv.ParseInt(row[0], 10, 64)
		if err != nil {
			continue
		}
		open, err  := strconv.ParseFloat(row[1], 64); if err != nil { continue }
		high, err  := strconv.ParseFloat(row[2], 64); if err != nil { continue }
		low, err   := strconv.ParseFloat(row[3], 64); if err != nil { continue }
		close_, err := strconv.ParseFloat(row[4], 64); if err != nil { continue }
		vol, err   := strconv.ParseFloat(row[5], 64); if err != nil { continue }

		candle := &Candle{
			Symbol:    sym,
			Interval:  interval,
			Ts:        ts,
			Open:      open,
			High:      high,
			Low:       low,
			Close:     close_,
			Volume:    vol,
			Confirmed: confirmed,
		}
		if confirmed {
			log.Printf("%s confirmed ts=%d close=%.4f", tag, ts, close_)
		}
		hub.broadcast(candle)
	}
}

// ──────────────────────────────────────────────
// main
// ──────────────────────────────────────────────

func main() {
	log.SetOutput(os.Stderr)
	log.SetFlags(log.Ldate | log.Ltime | log.Lmicroseconds)

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	hub := newHub()

	go runSocketServer(ctx, hub)

	var wg sync.WaitGroup

	// Standard intervals (1H/4H/1D) — all 5 symbols, confirmed only.
	for _, sym := range symbols {
		for _, iv := range intervals {
			wg.Add(1)
			go func(sym struct{ name, instId string }, iv struct{ label, channel string }) {
				defer wg.Done()
				runWorker(ctx, hub, sym.name, sym.instId, iv.label, iv.channel, false)
			}(sym, iv)
		}
	}

	// High-frequency intervals (1s/1min) — BTC/ETH/SOL only, emit live updates too.
	for _, sym := range liveSymbols {
		for _, iv := range liveIntervals {
			wg.Add(1)
			go func(sym struct{ name, instId string }, iv struct{ label, channel string }) {
				defer wg.Done()
				runWorker(ctx, hub, sym.name, sym.instId, iv.label, iv.channel, true)
			}(sym, iv)
		}
	}

	<-ctx.Done()
	log.Println("[main] shutting down…")
	wg.Wait()
	_ = os.Remove(sockPath)
	log.Println("[main] bye")
}
