export const ZONE_RUNNER_V2_LUA = `-- Zone Runner release builtin_zone_runner_2
-- All mutations use the documented creator API v1 and Lua stdlib v1.
local function schedule_turn_limit()
  if state.winner_id == nil then
    state.turn_timer_id = timer:after(settings.turnSeconds, "turn_timeout")
  end
end

function on_start(ctx)
  if props.role ~= "game" then return end
  state.winner_id = nil
  state.timeouts = 0
  turns:start()
  for _, player in ipairs(players:list()) do
    scores:set(player, 0)
  end
  local current = turns:current()
  refs.status:set(current.name .. " chooses the opening pace")
  ui:prompt(current, {
    id = "opening_move",
    title = "Choose your opening pace",
    choices = { "run", "wait" }
  })
  schedule_turn_limit()
end

function on_prompt(ctx)
  if props.role ~= "game" or ctx.promptId ~= "opening_move" then return end
  state.opening_choice = ctx.response
  refs.status:set(ctx.player.name .. " chose " .. ctx.response)
end

-- Live rooms start when the host enters; guests who join afterwards enter the
-- rotation behind the current player instead of being locked out of scoring.
function on_player_join(ctx)
  if props.role ~= "game" or state.winner_id ~= nil then return end
  scores:set(ctx.player, 0)
  local current = turns:current()
  if current ~= nil then turns:start(current) end
end

function turn_timeout(ctx)
  if state.winner_id ~= nil then return end
  state.timeouts = state.timeouts + 1
  local next_player = turns:next()
  refs.status:set(next_player.name .. " takes the turn")
  schedule_turn_limit()
end

function on_enter(ctx)
  if props.role ~= "scoring_zone" or state.winner_id ~= nil or ctx.player == nil then return end
  if not turns:is_current(ctx.player) then return end
  local value = scores:add(ctx.player, 1)
  scene:get("score_" .. ctx.player.seat.id):set(value)
  timer:cancel(state.turn_timer_id)
  if value >= settings.targetScore then
    local winner = scores:leader()
    state.winner_id = winner.id
    turns:stop()
    refs.status:set(winner.name .. " wins Zone Runner!")
    return
  end
  local next_player = turns:next()
  refs.status:set(next_player.name .. " takes the turn")
  schedule_turn_limit()
end

return {}
`;
