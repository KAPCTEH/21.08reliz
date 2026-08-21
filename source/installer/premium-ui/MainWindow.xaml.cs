using Microsoft.Win32;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

namespace JustFun.PremiumSetup;

public partial class MainWindow : Window
{
    private readonly string[] _arguments;
    private int _step;
    private bool _installing;
    private string _logPath = string.Empty;

    public MainWindow(string[] arguments)
    {
        _arguments = arguments;
        InitializeComponent();

        ProgramDirectoryText.Text = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Programs",
            "JustFun",
            "OrdersLogistics");
        DataDirectoryText.Text = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            "JustFun",
            "Заказы и логистика");

        Loaded += MainWindow_Loaded;
        SetStep(0);
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        var workArea = SystemParameters.WorkArea;
        Width = Math.Max(860, Math.Min(940, workArea.Width - 24));
        Height = Math.Max(520, Math.Min(580, workArea.Height - 24));
        Left = workArea.Left + Math.Max(0, (workArea.Width - Width) / 2);
        Top = workArea.Top + Math.Max(0, (workArea.Height - Height) / 2);

        var previewDirectory = GetPreviewDirectory(_arguments);
        if (!string.IsNullOrWhiteSpace(previewDirectory))
        {
            ShowActivated = false;
            await RenderPreviewsAsync(previewDirectory);
            Application.Current.Shutdown(0);
        }
    }

    private static string? GetPreviewDirectory(IReadOnlyList<string> args)
    {
        for (var index = 0; index < args.Count; index++)
        {
            if (args[index].StartsWith("--render-previews=", StringComparison.OrdinalIgnoreCase))
            {
                return args[index][("--render-previews=".Length)..].Trim('"');
            }
            if (args[index].Equals("--render-previews", StringComparison.OrdinalIgnoreCase)
                && index + 1 < args.Count)
            {
                return args[index + 1];
            }
        }
        return null;
    }

    private void SetStep(int step)
    {
        _step = step;
        WelcomePage.Visibility = step == 0 ? Visibility.Visible : Visibility.Collapsed;
        OptionsPage.Visibility = step == 1 ? Visibility.Visible : Visibility.Collapsed;
        ProgressPage.Visibility = step == 2 ? Visibility.Visible : Visibility.Collapsed;
        FinishPage.Visibility = step == 3 ? Visibility.Visible : Visibility.Collapsed;
        ErrorPage.Visibility = step == 4 ? Visibility.Visible : Visibility.Collapsed;

        var active = Math.Min(step, 3);
        SetStepIndicator(StepOne, StepOneText, active >= 0);
        SetStepIndicator(StepTwo, StepTwoText, active >= 1);
        SetStepIndicator(StepThree, StepThreeText, active >= 2);
        SetStepIndicator(StepFour, StepFourText, active >= 3);

        BackButton.Visibility = step == 1 ? Visibility.Visible : Visibility.Collapsed;
        CancelButton.IsEnabled = step != 2;
        CloseTitleButton.IsEnabled = step != 2;

        switch (step)
        {
            case 0:
                CancelButton.Content = "Отмена";
                CancelButton.Visibility = Visibility.Visible;
                PrimaryButton.Content = "Продолжить";
                PrimaryButton.Visibility = Visibility.Visible;
                PrimaryButton.IsEnabled = true;
                break;
            case 1:
                CancelButton.Content = "Отмена";
                CancelButton.Visibility = Visibility.Visible;
                PrimaryButton.Content = "Установить";
                PrimaryButton.Visibility = Visibility.Visible;
                PrimaryButton.IsEnabled = true;
                break;
            case 2:
                CancelButton.Content = "Установка выполняется";
                CancelButton.Visibility = Visibility.Visible;
                PrimaryButton.Visibility = Visibility.Collapsed;
                break;
            case 3:
                CancelButton.Content = "Закрыть";
                CancelButton.Visibility = Visibility.Visible;
                PrimaryButton.Content = "Запустить JustFun";
                PrimaryButton.Visibility = Visibility.Visible;
                PrimaryButton.IsEnabled = true;
                break;
            case 4:
                CancelButton.Content = "Закрыть";
                CancelButton.Visibility = Visibility.Visible;
                PrimaryButton.Content = "Открыть журнал";
                PrimaryButton.Visibility = Visibility.Visible;
                PrimaryButton.IsEnabled = File.Exists(_logPath);
                break;
        }
    }

    private static void SetStepIndicator(
        System.Windows.Controls.Border border,
        System.Windows.Controls.TextBlock text,
        bool active)
    {
        border.Background = new SolidColorBrush(
            (Color)ColorConverter.ConvertFromString(active ? "#E3B85C" : "#17372F"));
        border.BorderBrush = new SolidColorBrush(
            (Color)ColorConverter.ConvertFromString(active ? "#E3B85C" : "#4D6D64"));
        text.Foreground = new SolidColorBrush(
            (Color)ColorConverter.ConvertFromString(active ? "#071A15" : "#8CA49C"));
    }

    private void TitleBar_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton == MouseButton.Left)
        {
            DragMove();
        }
    }

    private void Minimize_Click(object sender, RoutedEventArgs e) =>
        WindowState = WindowState.Minimized;

    private void Close_Click(object sender, RoutedEventArgs e)
    {
        if (!_installing)
        {
            Application.Current.Shutdown(0);
        }
    }

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        if (!_installing)
        {
            Application.Current.Shutdown(0);
        }
    }

    private void Back_Click(object sender, RoutedEventArgs e)
    {
        ValidationMessage.Text = string.Empty;
        SetStep(0);
    }

    private async void Primary_Click(object sender, RoutedEventArgs e)
    {
        switch (_step)
        {
            case 0:
                SetStep(1);
                break;
            case 1:
                await BeginInstallationAsync();
                break;
            case 3:
                LaunchInstalledApplication();
                break;
            case 4:
                OpenLog();
                break;
        }
    }

    private void BrowseProgram_Click(object sender, RoutedEventArgs e) =>
        BrowseInto(ProgramDirectoryText, "Выберите папку установки программы");

    private void BrowseData_Click(object sender, RoutedEventArgs e) =>
        BrowseInto(DataDirectoryText, "Выберите отдельную папку рабочих данных");

    private static void BrowseInto(System.Windows.Controls.TextBox textBox, string title)
    {
        var dialog = new OpenFolderDialog
        {
            Title = title,
            Multiselect = false,
            InitialDirectory = Directory.Exists(textBox.Text)
                ? textBox.Text
                : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
        };
        if (dialog.ShowDialog() == true)
        {
            textBox.Text = dialog.FolderName;
        }
    }

    private async Task BeginInstallationAsync()
    {
        ValidationMessage.Text = string.Empty;
        if (!TryValidateDirectories(
                ProgramDirectoryText.Text,
                DataDirectoryText.Text,
                out var programDirectory,
                out var dataDirectory,
                out var validationError))
        {
            ValidationMessage.Text = validationError;
            return;
        }

        ProgramDirectoryText.Text = programDirectory;
        DataDirectoryText.Text = dataDirectory;
        FinishProgramPath.Text = programDirectory;
        FinishDataPath.Text = dataDirectory;

        _logPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "JustFun",
            "OrdersLogistics",
            "logs",
            "installer-7.8.3.log");
        Directory.CreateDirectory(Path.GetDirectoryName(_logPath)!);

        _installing = true;
        SetStep(2);
        try
        {
            var code = await SetupEngine.RunInteractiveAsync(
                programDirectory,
                dataDirectory,
                FullModeRadio.IsChecked == true ? "full" : "demo",
                DesktopShortcutCheck.IsChecked == true,
                StartShortcutCheck.IsChecked == true,
                _logPath,
                status => Dispatcher.Invoke(() => ProgressStatusText.Text = status));

            _installing = false;
            if (code == 0)
            {
                SetStep(3);
            }
            else
            {
                ShowInstallError(SetupEngine.ReadFailure(_logPath));
            }
        }
        catch (Exception exception)
        {
            _installing = false;
            ShowInstallError(exception.Message);
        }
    }

    private void ShowInstallError(string message)
    {
        ErrorMessageText.Text = message;
        ErrorLogPathText.Text = _logPath;
        SetStep(4);
    }

    private static bool TryValidateDirectories(
        string programInput,
        string dataInput,
        out string programDirectory,
        out string dataDirectory,
        out string error)
    {
        programDirectory = string.Empty;
        dataDirectory = string.Empty;
        error = string.Empty;
        try
        {
            programDirectory = NormalizePath(programInput);
            dataDirectory = NormalizePath(dataInput);
        }
        catch
        {
            error = "Проверьте пути: Windows не может распознать одну из выбранных папок.";
            return false;
        }

        if (programDirectory.Length < 4 || dataDirectory.Length < 4)
        {
            error = "Выберите отдельные папки программы и рабочих данных.";
            return false;
        }

        if (programDirectory.Equals(dataDirectory, StringComparison.OrdinalIgnoreCase))
        {
            error = "Папка программы и папка рабочих данных должны быть раздельными.";
            return false;
        }

        if (IsInside(programDirectory, dataDirectory))
        {
            error = "Папка рабочих данных не может находиться внутри папки программы.";
            return false;
        }

        if (IsInside(dataDirectory, programDirectory))
        {
            error = "Папка программы не может находиться внутри папки рабочих данных.";
            return false;
        }

        var forbiddenRoots = new[]
        {
            Environment.GetFolderPath(Environment.SpecialFolder.Windows),
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            Path.GetTempPath()
        }.Where(value => !string.IsNullOrWhiteSpace(value))
         .Select(NormalizePath)
         .ToArray();

        foreach (var root in forbiddenRoots)
        {
            if (programDirectory.Equals(root, StringComparison.OrdinalIgnoreCase))
            {
                error = "Для программы выберите отдельную вложенную папку, а не системный каталог.";
                return false;
            }
            if (dataDirectory.Equals(root, StringComparison.OrdinalIgnoreCase))
            {
                error = "Для рабочих данных выберите отдельную вложенную папку.";
                return false;
            }
        }
        return true;
    }

    private static string NormalizePath(string value) =>
        Path.GetFullPath(value.Trim().Trim('"'))
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);

    private static bool IsInside(string parent, string candidate) =>
        candidate.StartsWith(
            parent.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar,
            StringComparison.OrdinalIgnoreCase);

    private void LaunchInstalledApplication()
    {
        var executable = Path.Combine(ProgramDirectoryText.Text, "OrdersLogistics.exe");
        if (!File.Exists(executable))
        {
            _logPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "JustFun",
                "OrdersLogistics",
                "logs");
            ShowInstallError("Главный файл программы не найден после установки.");
            return;
        }

        Process.Start(new ProcessStartInfo(executable)
        {
            UseShellExecute = true,
            WorkingDirectory = ProgramDirectoryText.Text
        });
        Application.Current.Shutdown(0);
    }

    private void OpenLog()
    {
        if (!File.Exists(_logPath))
        {
            return;
        }
        Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{_logPath}\"")
        {
            UseShellExecute = true
        });
    }

    private async Task RenderPreviewsAsync(string directory)
    {
        Directory.CreateDirectory(directory);
        await Dispatcher.InvokeAsync(() => { }, DispatcherPriority.Loaded);

        SetStep(0);
        await CaptureAsync(Path.Combine(directory, "01-welcome.png"));

        SetStep(1);
        ValidationMessage.Text = string.Empty;
        await CaptureAsync(Path.Combine(directory, "02-options.png"));

        SetStep(2);
        ProgressStatusText.Text = "Распаковка и проверка установочного пакета";
        await CaptureAsync(Path.Combine(directory, "03-progress.png"));

        FinishProgramPath.Text = ProgramDirectoryText.Text;
        FinishDataPath.Text = DataDirectoryText.Text;
        SetStep(3);
        await CaptureAsync(Path.Combine(directory, "04-finish.png"));

        _logPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "JustFun",
            "OrdersLogistics",
            "logs",
            "installer-7.8.3.log");
        ErrorMessageText.Text = "Пример: целостность встроенного пакета не подтверждена. Установка остановлена без изменения прежней версии.";
        ErrorLogPathText.Text = _logPath;
        SetStep(4);
        PrimaryButton.IsEnabled = true;
        await CaptureAsync(Path.Combine(directory, "05-error.png"));
    }

    private async Task CaptureAsync(string path)
    {
        await Dispatcher.InvokeAsync(() => { }, DispatcherPriority.Render);
        ShellRoot.UpdateLayout();
        var width = Math.Max(1, (int)Math.Ceiling(ShellRoot.ActualWidth));
        var height = Math.Max(1, (int)Math.Ceiling(ShellRoot.ActualHeight));
        var bitmap = new RenderTargetBitmap(
            width,
            height,
            96,
            96,
            PixelFormats.Pbgra32);
        bitmap.Render(ShellRoot);
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(bitmap));
        await using var stream = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.None);
        encoder.Save(stream);
    }
}
