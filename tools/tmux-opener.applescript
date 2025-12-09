on open location theURL
    -- Extract session name from tmux://session-name
    set sessionName to text 8 thru -1 of theURL -- removes "tmux://"

    -- Remove trailing slash if present
    if sessionName ends with "/" then
        set sessionName to text 1 thru -2 of sessionName
    end if

    if sessionName is "" then
        display alert "Tmux Opener" message "No session name provided in URL"
        return
    end if

    -- Check if tmux session exists
    try
        do shell script "/opt/homebrew/bin/tmux has-session -t " & quoted form of sessionName
    on error
        display alert "Tmux Session Not Found" message "Session '" & sessionName & "' does not exist"
        return
    end try

    -- Open Ghostty with tmux attach command
    do shell script "open -na Ghostty.app --args -e /opt/homebrew/bin/tmux attach -t " & sessionName
end open location
