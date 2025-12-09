on open location theURL
    -- Extract session ID from tmux://session-id
    set sessionId to text 8 thru -1 of theURL -- removes "tmux://"

    -- Remove trailing slash if present
    if sessionId ends with "/" then
        set sessionId to text 1 thru -2 of sessionId
    end if

    if sessionId is "" then
        display alert "Tmux Opener" message "No session ID provided in URL"
        return
    end if

    -- The tmux session name follows the pattern: dev-assistant-{sessionId}
    set tmuxSessionName to "dev-assistant-" & sessionId

    -- Check if tmux session exists
    try
        do shell script "/opt/homebrew/bin/tmux has-session -t " & quoted form of tmuxSessionName
        -- Session exists, attach to it
        do shell script "open -na Ghostty.app --args -e /opt/homebrew/bin/tmux attach -t " & tmuxSessionName
    on error
        -- Session doesn't exist, open terminal with echo command showing the info
        do shell script "open -na Ghostty.app --args -e /bin/zsh -c 'echo \"Session " & sessionId & " not found (tmux: " & tmuxSessionName & ")\"; exec /bin/zsh'"
    end try
end open location
