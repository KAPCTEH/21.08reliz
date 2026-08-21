using System.Windows;

namespace JustFun.PremiumSetup;

public partial class App : Application
{
    private Mutex? _singleInstanceMutex;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        _singleInstanceMutex = new Mutex(
            initiallyOwned: true,
            name: @"Local\JustFun.OrdersLogistics.PremiumSetup",
            createdNew: out var createdNew);
        if (!createdNew)
        {
            if (!SetupEngine.IsSilentInvocation(e.Args))
            {
                MessageBox.Show(
                    "Установщик JustFun уже запущен. Завершите открытую установку и повторите попытку.",
                    "JustFun — установка",
                    MessageBoxButton.OK,
                    MessageBoxImage.Information);
            }
            Shutdown(21);
            return;
        }

        if (SetupEngine.IsSilentInvocation(e.Args))
        {
            int code;
            try
            {
                code = SetupEngine.RunPassthrough(e.Args);
            }
            catch
            {
                code = 10;
            }
            Shutdown(code);
            return;
        }

        var window = new MainWindow(e.Args);
        MainWindow = window;
        window.Show();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        try
        {
            _singleInstanceMutex?.ReleaseMutex();
        }
        catch (ApplicationException)
        {
            // The process is already shutting down and no longer owns the mutex.
        }
        _singleInstanceMutex?.Dispose();
        base.OnExit(e);
    }
}
